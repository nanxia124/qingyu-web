\set ON_ERROR_STOP on
BEGIN;
INSERT INTO app.backup_runs(backup_type,scope,source_database,storage_provider,storage_key,status)
VALUES ('logical','business','qingyu_business','test','backup/test-1.sql.gz','started')
RETURNING id \gset backup_
UPDATE app.backup_runs
SET checksum_sha256=repeat('a',64), size_bytes=10, finished_at=now(), status='succeeded'
WHERE id=:'backup_id';
UPDATE app.backup_runs SET status='verified', verified_at=now() WHERE id=:'backup_id';
SELECT set_config('test.backup_id', :'backup_id', false);
INSERT INTO app.restore_drills(backup_id,environment,status,target_time,restored_at,completed_at,rpo_seconds,rto_seconds,checks)
VALUES (:'backup_id','isolated-test','passed',now()-interval '1 minute',now(),now(),60,120,'{"rls":true,"billing":true}'::jsonb);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.backup_runs WHERE id=current_setting('test.backup_id')::uuid AND status='verified') THEN
    RAISE EXCEPTION '备份验证状态没有保存';
  END IF;
  RAISE NOTICE 'PASS: 备份校验和、验证状态和恢复演练结果可追踪';
END $$;
ROLLBACK;
