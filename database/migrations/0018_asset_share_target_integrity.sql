-- 分享目标必须与 target_type 对应，并且目标对象真实存在。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE OR REPLACE FUNCTION app.validate_asset_share_target()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.target_type = 'public_link' THEN
        IF NEW.target_id IS NOT NULL THEN
            RAISE EXCEPTION '公开链接分享不能填写对象编号';
        END IF;
    ELSIF NEW.target_id IS NULL THEN
        RAISE EXCEPTION '分享目标编号不能为空';
    ELSIF NEW.target_type = 'workspace' AND NOT EXISTS (
        SELECT 1 FROM app.workspaces WHERE id = NEW.target_id AND status <> 'deleted'
    ) THEN
        RAISE EXCEPTION '分享目标工作空间不存在';
    ELSIF NEW.target_type = 'team' AND NOT EXISTS (
        SELECT 1 FROM app.teams WHERE id = NEW.target_id AND status <> 'deleted'
    ) THEN
        RAISE EXCEPTION '分享目标团队不存在';
    ELSIF NEW.target_type = 'department' AND NOT EXISTS (
        SELECT 1 FROM app.departments WHERE id = NEW.target_id AND status <> 'deleted'
    ) THEN
        RAISE EXCEPTION '分享目标部门不存在';
    ELSIF NEW.target_type = 'user' AND NOT EXISTS (
        SELECT 1 FROM app.user_accounts WHERE id = NEW.target_id AND status <> 'deleted'
    ) THEN
        RAISE EXCEPTION '分享目标用户不存在';
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS asset_share_target_check ON app.asset_shares;
CREATE TRIGGER asset_share_target_check
BEFORE INSERT OR UPDATE OF target_type, target_id ON app.asset_shares
FOR EACH ROW EXECUTE FUNCTION app.validate_asset_share_target();

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0018_asset_share_target_integrity', 'asset-share-target-integrity-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
