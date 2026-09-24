-- 用户反馈必须落库；网络失败时前端不能伪造“提交成功”。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE TABLE IF NOT EXISTS app.feedback_submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    workspace_id uuid REFERENCES app.workspaces(id) ON DELETE SET NULL,
    feedback_type varchar(32) NOT NULL CHECK (feedback_type IN ('suggestion','bug','other')),
    content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 10000),
    contact varchar(320),
    status varchar(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','resolved','closed')),
    handled_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    handled_at timestamptz,
    resolution text,
    request_id varchar(160),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (contact IS NULL OR length(contact) <= 320),
    CHECK ((status IN ('resolved','closed') AND handled_at IS NOT NULL) OR status IN ('pending','processing'))
);

CREATE INDEX IF NOT EXISTS feedback_submissions_created_idx
    ON app.feedback_submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_submissions_status_idx
    ON app.feedback_submissions(status, created_at DESC)
    WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS feedback_submissions_user_idx
    ON app.feedback_submissions(user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION app.touch_feedback_submission_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS feedback_submissions_touch_updated ON app.feedback_submissions;
CREATE TRIGGER feedback_submissions_touch_updated
BEFORE UPDATE ON app.feedback_submissions
FOR EACH ROW EXECUTE FUNCTION app.touch_feedback_submission_updated_at();

ALTER TABLE app.feedback_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feedback_owner_isolation ON app.feedback_submissions;
CREATE POLICY feedback_owner_isolation ON app.feedback_submissions
    FOR SELECT USING (user_id IS NOT NULL AND user_id = app.current_user_id());

GRANT INSERT ON app.feedback_submissions TO qingyu_api;
GRANT SELECT ON app.feedback_submissions TO qingyu_api;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0050_feedback_submissions', 'feedback-submissions-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
