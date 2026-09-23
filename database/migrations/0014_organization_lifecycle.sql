-- 组织关系、生命周期和软删除边界。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE OR REPLACE FUNCTION app.prevent_department_cycle()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_id = NEW.id THEN RAISE EXCEPTION '部门不能把自己设为父部门'; END IF;
  IF EXISTS (
    WITH RECURSIVE ancestors(id) AS (
      SELECT NEW.parent_id
      UNION
      SELECT d.parent_id
      FROM app.departments d JOIN ancestors a ON d.id=a.id AND d.team_id=NEW.team_id
      WHERE d.parent_id IS NOT NULL
    ) SELECT 1 FROM ancestors WHERE id=NEW.id
  ) THEN RAISE EXCEPTION '部门层级不能形成环'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS departments_no_cycle ON app.departments;
CREATE TRIGGER departments_no_cycle BEFORE INSERT OR UPDATE OF parent_id,team_id ON app.departments
FOR EACH ROW EXECUTE FUNCTION app.prevent_department_cycle();

CREATE OR REPLACE FUNCTION app.validate_membership_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='invited' AND (NEW.joined_at IS NOT NULL OR NEW.left_at IS NOT NULL) THEN
    RAISE EXCEPTION '邀请中的成员不能有入职或离职时间';
  END IF;
  IF NEW.status IN ('active','suspended') AND NEW.joined_at IS NULL THEN
    RAISE EXCEPTION '在职或暂停成员必须有入职时间';
  END IF;
  IF NEW.status='left' AND (NEW.joined_at IS NULL OR NEW.left_at IS NULL OR NEW.left_at < NEW.joined_at) THEN
    RAISE EXCEPTION '离职成员的入职和离职时间无效';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS memberships_lifecycle_check ON app.team_memberships;
CREATE TRIGGER memberships_lifecycle_check BEFORE INSERT OR UPDATE OF status,joined_at,left_at ON app.team_memberships
FOR EACH ROW EXECUTE FUNCTION app.validate_membership_lifecycle();

CREATE OR REPLACE FUNCTION app.validate_invitation_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='accepted' AND NEW.accepted_at IS NULL THEN RAISE EXCEPTION '已接受邀请必须有接受时间'; END IF;
  IF NEW.status IN ('pending','expired','revoked') AND NEW.accepted_at IS NOT NULL THEN RAISE EXCEPTION '未接受邀请不能有接受时间'; END IF;
  IF NEW.expires_at <= NEW.created_at THEN RAISE EXCEPTION '邀请过期时间必须晚于创建时间'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS invitations_lifecycle_check ON app.team_invitations;
CREATE TRIGGER invitations_lifecycle_check BEFORE INSERT OR UPDATE OF status,accepted_at,expires_at ON app.team_invitations
FOR EACH ROW EXECUTE FUNCTION app.validate_invitation_lifecycle();

CREATE OR REPLACE FUNCTION app.validate_role_binding_membership()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w app.workspaces%ROWTYPE;
BEGIN
  SELECT * INTO w FROM app.workspaces WHERE id=NEW.workspace_id;
  IF w.type='personal' AND w.owner_user_id <> NEW.user_id THEN RAISE EXCEPTION '个人空间角色只能绑定给所有者'; END IF;
  IF w.type='team' AND NOT EXISTS (
    SELECT 1 FROM app.team_memberships tm WHERE tm.team_id=w.team_id AND tm.user_id=NEW.user_id AND tm.status IN ('active','suspended')
  ) THEN RAISE EXCEPTION '团队空间角色只能绑定给团队成员'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS role_bindings_membership_check ON app.role_bindings;
CREATE TRIGGER role_bindings_membership_check BEFORE INSERT OR UPDATE OF workspace_id,user_id ON app.role_bindings
FOR EACH ROW EXECUTE FUNCTION app.validate_role_binding_membership();

CREATE TABLE IF NOT EXISTS app.data_export_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES app.user_accounts(id) ON DELETE RESTRICT,
    workspace_id uuid REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','queued','running','succeeded','failed','expired','cancelled')),
    idempotency_key varchar(160) NOT NULL UNIQUE,
    requested_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz,
    storage_key text,
    checksum_sha256 char(64),
    expires_at timestamptz,
    error_message text,
    CHECK ((status='succeeded' AND finished_at IS NOT NULL AND storage_key IS NOT NULL) OR status <> 'succeeded')
);

CREATE TABLE IF NOT EXISTS app.data_deletion_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES app.user_accounts(id) ON DELETE RESTRICT,
    workspace_id uuid REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','processing','completed','rejected','cancelled','blocked_legal_hold')),
    reason text,
    requested_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    requested_at timestamptz NOT NULL DEFAULT now(),
    scheduled_at timestamptz,
    completed_at timestamptz,
    legal_hold boolean NOT NULL DEFAULT false,
    result_summary jsonb,
    CHECK ((status='completed' AND completed_at IS NOT NULL) OR status <> 'completed'),
    CHECK (NOT legal_hold OR status='blocked_legal_hold')
);

CREATE TABLE IF NOT EXISTS app.resource_tombstones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    resource_type varchar(80) NOT NULL,
    resource_id uuid NOT NULL,
    deleted_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    reason text,
    payload_hash varchar(128),
    deleted_at timestamptz NOT NULL DEFAULT now(),
    purge_after timestamptz,
    UNIQUE (workspace_id, resource_type, resource_id)
);

REVOKE ALL ON app.data_export_jobs, app.data_deletion_requests, app.resource_tombstones FROM qingyu_app;
CREATE INDEX IF NOT EXISTS data_export_jobs_user_idx ON app.data_export_jobs(user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS data_deletion_requests_status_idx ON app.data_deletion_requests(status, scheduled_at);
CREATE INDEX IF NOT EXISTS resource_tombstones_workspace_idx ON app.resource_tombstones(workspace_id, deleted_at DESC);

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0014_organization_lifecycle', 'organization-lifecycle-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
