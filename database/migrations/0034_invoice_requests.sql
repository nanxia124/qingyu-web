-- 电子发票申请：用户选择已支付订单合并申请开票，管理员审核后上传 PDF。
BEGIN;
SELECT pg_advisory_xact_lock(70420260930);

CREATE TABLE IF NOT EXISTS app.invoice_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES app.user_accounts(id),
    workspace_id uuid REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    title_type text NOT NULL CHECK (title_type IN ('personal','company')),
    title_name text NOT NULL,
    tax_no text,
    email text NOT NULL,
    total_minor bigint NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
    pdf_url text,
    reject_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS invoice_requests_user_idx ON app.invoice_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invoice_requests_status_idx ON app.invoice_requests(status) WHERE status IN ('pending','processing');

-- 兼容线上已经存在的旧发票表：先按用户的个人工作空间回填，再收紧为必填。
ALTER TABLE app.invoice_requests ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES app.workspaces(id) ON DELETE RESTRICT;
UPDATE app.invoice_requests r
   SET workspace_id = w.id
  FROM app.workspaces w
 WHERE r.workspace_id IS NULL
   AND w.owner_user_id = r.user_id
   AND w.type = 'personal'
   AND w.status <> 'deleted';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.invoice_requests WHERE workspace_id IS NULL) THEN
    RAISE EXCEPTION '发票申请存在无法归属工作空间的历史记录，迁移已回滚';
  END IF;
END $$;
ALTER TABLE app.invoice_requests ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS invoice_requests_workspace_idx ON app.invoice_requests(workspace_id, created_at DESC);

-- 一张订单只能被一张发票申请覆盖，防止重复开票。
CREATE TABLE IF NOT EXISTS app.invoice_request_orders (
    request_id uuid NOT NULL REFERENCES app.invoice_requests(id) ON DELETE CASCADE,
    order_id uuid NOT NULL UNIQUE REFERENCES app.orders(id),
    order_no text NOT NULL,
    amount_minor bigint NOT NULL,
    PRIMARY KEY (request_id, order_id)
);

CREATE OR REPLACE FUNCTION app.validate_invoice_request_order_workspace()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM app.invoice_requests r
          JOIN app.orders o ON o.id = NEW.order_id
         WHERE r.id = NEW.request_id
           AND r.workspace_id = o.workspace_id
    ) THEN
        RAISE EXCEPTION '发票申请和订单不属于同一工作空间';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS invoice_request_order_workspace_guard ON app.invoice_request_orders;
CREATE CONSTRAINT TRIGGER invoice_request_order_workspace_guard
AFTER INSERT OR UPDATE ON app.invoice_request_orders
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.validate_invoice_request_order_workspace();

CREATE OR REPLACE FUNCTION app.touch_invoice_request_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS invoice_requests_touch_updated ON app.invoice_requests;
CREATE TRIGGER invoice_requests_touch_updated
BEFORE UPDATE ON app.invoice_requests
FOR EACH ROW EXECUTE FUNCTION app.touch_invoice_request_updated_at();

ALTER TABLE app.invoice_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_request_owner_isolation ON app.invoice_requests;
CREATE POLICY invoice_request_owner_isolation ON app.invoice_requests
    USING (user_id = app.current_user_id())
    WITH CHECK (user_id = app.current_user_id());
ALTER TABLE app.invoice_request_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_request_order_owner_isolation ON app.invoice_request_orders;
CREATE POLICY invoice_request_order_owner_isolation ON app.invoice_request_orders
    USING (EXISTS (SELECT 1 FROM app.invoice_requests r WHERE r.id=request_id AND r.user_id=app.current_user_id()))
    WITH CHECK (EXISTS (SELECT 1 FROM app.invoice_requests r WHERE r.id=request_id AND r.user_id=app.current_user_id()));

GRANT SELECT,INSERT,UPDATE ON app.invoice_requests,app.invoice_request_orders TO qingyu_api;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0034_invoice_requests', 'invoice-requests-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
