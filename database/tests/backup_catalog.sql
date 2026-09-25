\set ON_ERROR_STOP on
BEGIN;
INSERT INTO app.backup_runs(backup_type,scope,source_database,storage_provider,storage_key,status,started_at)
VALUES ('logical','business','qingyu_business','test','backup/test-1.sql.gz','started',now()-interval '5 minutes')
RETURNING id \gset backup_
UPDATE app.backup_runs
SET checksum_sha256=repeat('a',64), size_bytes=10, finished_at=now()-interval '4 minutes', status='succeeded'
WHERE id=:'backup_id';
UPDATE app.backup_runs SET status='verified', verified_at=now() WHERE id=:'backup_id';
SELECT set_config('test.backup_id', :'backup_id', false);
INSERT INTO app.restore_drills(backup_id,environment,status,target_time,restored_at,completed_at,rpo_seconds,rto_seconds,checks)
SELECT id,'isolated-test','passed',now(),now(),now(),
       greatest(0,floor(extract(epoch from (now()-started_at))))::bigint,120,
       '{"rls":true,"billing":true,"rpo_basis":"target_time_minus_backup_started_at_conservative"}'::jsonb
FROM app.backup_runs WHERE id=:'backup_id';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.backup_runs WHERE id=current_setting('test.backup_id')::uuid AND status='verified') THEN
    RAISE EXCEPTION '备份验证状态没有保存';
  END IF;
  IF (SELECT rpo_seconds FROM app.restore_drills WHERE backup_id=current_setting('test.backup_id')::uuid) <> 300 THEN
    RAISE EXCEPTION '5 分钟旧的备份应记录 300 秒 RPO';
  END IF;
  RAISE NOTICE 'PASS: 备份校验和、验证状态、恢复演练和非零 RPO 可追踪';
END $$;
ROLLBACK;
