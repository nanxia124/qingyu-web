BEGIN;
DO $$
DECLARE u1 uuid; u2 uuid; w1 uuid; w2 uuid; q1 uuid; r1 uuid; rejected_constraint text;
BEGIN
  INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('verify-scope-' || gen_random_uuid()) RETURNING id INTO u1;
  INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('verify-scope-' || gen_random_uuid()) RETURNING id INTO u2;
  INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',u1,'scope-test-1') RETURNING id INTO w1;
  INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',u2,'scope-test-2') RETURNING id INTO w2;
  INSERT INTO app.quota_accounts(workspace_id,quota_code,granted) VALUES (w1,'monthly',10) RETURNING id INTO q1;
  INSERT INTO app.quota_reservations(account_id,workspace_id,quota_code,amount,idempotency_key,expires_at) VALUES (q1,w1,'monthly',1,gen_random_uuid()::text,now()+interval '1 hour') RETURNING id INTO r1;
  BEGIN
    INSERT INTO app.usage_records(workspace_id,user_id,feature_code,quantity,unit,result,idempotency_key) VALUES (w1,u2,'image',1,'request','reserved',gen_random_uuid()::text);
    RAISE EXCEPTION 'usage actor workspace mismatch was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%使用记录用户不属于目标工作空间%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO app.usage_records(workspace_id,user_id,feature_code,quantity,unit,result,idempotency_key,quota_reservation_id) VALUES (w2,u2,'image',1,'request','reserved',gen_random_uuid()::text,r1);
    RAISE EXCEPTION 'quota workspace mismatch was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
    IF rejected_constraint <> 'usage_records_quota_reservation_scope_fk' THEN RAISE; END IF;
  END;
  INSERT INTO app.usage_records(workspace_id,user_id,feature_code,quantity,unit,result,idempotency_key,quota_reservation_id) VALUES (w1,u1,'image',1,'request','reserved',gen_random_uuid()::text,r1);
END $$;
ROLLBACK;
