\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE u uuid; w uuid; other_user uuid; other_w uuid; account_id uuid; reservation_id uuid; usage_id uuid;
    audit_id uuid; repeated uuid; decision text; balance record;
BEGIN
    INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('reconciliation-test-'||gen_random_uuid()) RETURNING id INTO u;
    INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',u,'核对测试') RETURNING id INTO w;
    INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('reconciliation-other-'||gen_random_uuid()) RETURNING id INTO other_user;
    INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',other_user,'隔离测试') RETURNING id INTO other_w;
    INSERT INTO app.quota_accounts(workspace_id,quota_code,granted) VALUES(w,'monthly',10) RETURNING id INTO account_id;
    IF has_function_privilege('qingyu_app','app.reconcile_provider_usage(uuid,text,text,text,text)','EXECUTE') THEN
        RAISE EXCEPTION '普通角色拥有核对权限';
    END IF;
    PERFORM set_config('app.user_id',u::text,true);
    FOREACH decision IN ARRAY ARRAY['committed','released'] LOOP
        SELECT app.reserve_quota(w,'monthly',1,gen_random_uuid()::text,now()+interval '1 minute') INTO reservation_id;
        UPDATE app.quota_reservations SET expires_at=now()-interval '1 minute' WHERE id=reservation_id;
        INSERT INTO app.usage_records(workspace_id,user_id,feature_code,quantity,unit,result,idempotency_key,quota_reservation_id)
          VALUES(w,u,'ai_proxy',1,'request','unknown',gen_random_uuid()::text,
            reservation_id) RETURNING id INTO usage_id;
        EXECUTE 'SET LOCAL ROLE qingyu_api';
        SELECT app.reconcile_provider_usage(usage_id,'test-admin',decision,'供应商测试凭据已核对','test-reference') INTO audit_id;
        SELECT app.reconcile_provider_usage(usage_id,'test-admin',decision,'重复请求','test-reference') INTO repeated;
        IF audit_id<>repeated THEN RAISE EXCEPTION '核对重复提交产生不同记录'; END IF;
        BEGIN
          PERFORM app.reconcile_provider_usage(usage_id,'test-admin',CASE WHEN decision='committed' THEN 'released' ELSE 'committed' END,'相反结论','test-reference');
          RAISE EXCEPTION '错误允许覆盖结论';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM<>'已有核对结论，不能覆盖' THEN RAISE; END IF;
        END;
        EXECUTE 'RESET ROLE';
        BEGIN
          UPDATE app.usage_reconciliations SET reason='篡改' WHERE id=audit_id;
          RAISE EXCEPTION '错误允许篡改审计';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM NOT LIKE '%只允许追加%' THEN RAISE; END IF;
        END;
        IF NOT EXISTS(SELECT 1 FROM app.usage_records WHERE id=usage_id AND result=CASE WHEN decision='committed' THEN 'committed' ELSE 'failed' END) THEN
          RAISE EXCEPTION '调用结果未更新';
        END IF;
    END LOOP;
    SELECT granted,reserved,consumed INTO balance FROM app.quota_accounts WHERE id=account_id;
    IF balance.granted<>10 OR balance.reserved<>0 OR balance.consumed<>1 THEN RAISE EXCEPTION '核对后额度不守恒'; END IF;
    INSERT INTO app.quota_accounts(workspace_id,quota_code,granted)
      VALUES(other_w,'monthly',10);
    PERFORM set_config('app.user_id',other_user::text,true);
    SELECT app.reserve_quota(other_w,'monthly',1,gen_random_uuid()::text,now()+interval '1 minute') INTO reservation_id;
    PERFORM set_config('app.user_id',u::text,true);
    BEGIN
      INSERT INTO app.usage_records(workspace_id,user_id,feature_code,quantity,unit,result,idempotency_key,quota_reservation_id)
        VALUES(w,u,'ai_proxy',1,'request','unknown',gen_random_uuid()::text,reservation_id) RETURNING id INTO usage_id;
      RAISE EXCEPTION '错误允许跨空间额度预占关联';
    EXCEPTION WHEN foreign_key_violation THEN
      IF SQLERRM NOT LIKE '%usage_records_quota_reservation_scope_fk%' THEN RAISE; END IF;
      RAISE NOTICE 'PASS: 跨空间额度预占在写入 usage_records 时被拒绝';
    END;
    RAISE NOTICE 'PASS: 过期积分预占核对、幂等、相反结论拒绝、审计不可变、跨空间拒绝及额度守恒';
END $$;
ROLLBACK;
