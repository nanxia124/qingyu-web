-- 全部测试数据随事务回滚，不修改已有业务数据。
BEGIN;
DO $$
DECLARE u1 uuid; u2 uuid; w1 uuid; w2 uuid; g uuid; usage1 uuid; usage2 uuid; rejected_constraint text;
BEGIN
  INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('verify-'||gen_random_uuid()) RETURNING id INTO u1;
  INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('verify-'||gen_random_uuid()) RETURNING id INTO u2;
  INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',u1,'分配测试甲') RETURNING id INTO w1;
  INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',u2,'分配测试乙') RETURNING id INTO w2;
  INSERT INTO app.quota_grants(workspace_id,quota_code,source_type,granted) VALUES(w1,'monthly','manual',10) RETURNING id INTO g;
  INSERT INTO app.usage_records(workspace_id,user_id,feature_code,quantity,unit,result,idempotency_key) VALUES(w1,u1,'test',1,'request','reserved',gen_random_uuid()::text) RETURNING id INTO usage1;
  INSERT INTO app.usage_records(workspace_id,user_id,feature_code,quantity,unit,result,idempotency_key) VALUES(w2,u2,'test',1,'request','reserved',gen_random_uuid()::text) RETURNING id INTO usage2;
  INSERT INTO app.quota_allocations(workspace_id,grant_id,usage_record_id,amount,idempotency_key) VALUES(w1,g,usage1,1,gen_random_uuid()::text);
  BEGIN
    INSERT INTO app.quota_allocations(workspace_id,grant_id,usage_record_id,amount,idempotency_key) VALUES(w1,g,usage2,1,gen_random_uuid()::text);
    RAISE EXCEPTION '跨空间使用记录未被拒绝';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
    IF rejected_constraint <> 'quota_allocations_usage_scope_fk' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO app.quota_allocations(workspace_id,grant_id,usage_record_id,amount,idempotency_key) VALUES(w2,g,usage2,1,gen_random_uuid()::text);
    RAISE EXCEPTION '跨空间额度批次未被拒绝';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
    IF rejected_constraint <> 'quota_allocations_grant_scope_fk' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;
