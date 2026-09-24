\set ON_ERROR_STOP on
BEGIN;

INSERT INTO app.backup_runs(backup_type,scope,source_database,storage_provider,storage_key,status,finished_at)
VALUES ('logical','test','qingyu_business','test','test-backup-copy-' || gen_random_uuid(),'succeeded',now())
RETURNING id \gset backup_
SELECT set_config('test.backup_id', :'backup_id', true);

INSERT INTO app.backup_copies(backup_id,storage_provider,storage_key,status,uploaded_at)
VALUES (:'backup_id','test','copy-a','uploaded',now())
RETURNING id \gset copy_
SELECT set_config('test.copy_id', :'copy_id', true);

UPDATE app.backup_copies
   SET status='verified',verified_at=now(),checksum_sha256=repeat('a',64),size_bytes=10
 WHERE id=:'copy_id';

DO $$
BEGIN
  BEGIN
    INSERT INTO app.backup_copies(backup_id,storage_provider,storage_key,status)
    VALUES (current_setting('test.backup_id')::uuid,'test','copy-a','started');
    RAISE EXCEPTION '应拒绝重复副本';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM app.backup_copies WHERE id=current_setting('test.copy_id')::uuid AND status='verified') THEN
    RAISE EXCEPTION '副本没有进入 verified';
  END IF;
END $$;

ROLLBACK;
SELECT 'PASS: 备份副本状态、校验字段和重复保护有效';
