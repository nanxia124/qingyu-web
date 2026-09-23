\set ON_ERROR_STOP on
BEGIN;
INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('session-test-' || gen_random_uuid()) RETURNING id \gset session_user_
INSERT INTO app.user_devices(user_id,installation_id) VALUES (:'session_user_id',gen_random_uuid()) RETURNING id \gset device_
INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',:'session_user_id','同步测试空间') RETURNING id \gset sync_space_
INSERT INTO app.user_sessions(user_id,device_id,provider_session_id,admission_status,expires_at)
VALUES (:'session_user_id',:'device_id','session-a','active',now()+interval '1 hour') RETURNING id \gset session_a_
INSERT INTO app.user_sessions(user_id,device_id,provider_session_id,admission_status,expires_at)
VALUES (:'session_user_id',:'device_id','session-b','active',now()+interval '1 hour');
SELECT set_config('app.user_id', :'session_user_id', true);
SELECT app.revoke_other_sessions(:'session_a_id','test_revoke');
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.user_sessions WHERE user_id=current_setting('app.user_id')::uuid AND admission_status='revoked';
  IF n<>1 THEN RAISE EXCEPTION '撤销其他设备失败：%',n; END IF;
  RAISE NOTICE 'PASS: 多设备会话可记录，并可撤销除当前会话外的其他会话';
END $$;
ROLLBACK;
