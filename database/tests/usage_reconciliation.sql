\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE u uuid; w uuid; other_w uuid; account_id uuid; reservation_id uuid; usage_id uuid;
    audit_id uuid; repeated uuid; decision text; kind text; balance record;
BEGIN
    INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('reconciliation-test-'||gen_random_uuid()) RETURNING id INTO u;
    INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',u,'核对测试') RETURNING id INTO w;
    INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('reconciliation-other-'||gen_random_uuid()) RETURNING id INTO other_w;
    INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',other_w,'隔离测试') RETURNING id INTO other_w;
    INSERT INTO app.quota_accounts(workspace_id,quota_code,granted) VALUES(w,'monthly',10) RETURNING id INTO account_id;
    IF has_function_privilege('qingyu_app','app.reconcile_provider_usage(uuid,text,text,text,text)','EXECUTE') THEN
        RAISE EXCEPTION '普通角色拥有核对权限';
    END IF;
    PERFORM set_config('app.user_id',u::text,true);
    FOREACH kind IN ARRAY ARRAY['paid','free'] LOOP
      FOREACH decision IN ARRAY ARRAY['committed','released'] LOOP
        IF kind='paid' THEN
          SELECT app.reserve_quota(w,'monthly',1,gen_random_uuid()::text,now()+interval '1 minute') INTO reservation_id;
          UPDATE app.quota_reservations SET expires_at=now()-interval '1 minute' WHERE id=reservation_id;
        ELSE
          SELECT app.reserve_free_daily_usage(w,u,'ai_proxy',1,gen_random_uuid()::text,20,now()+interval '1 minute') INTO reservation_id;
          UPDATE app.daily_usage_reservations SET expires_at=now()-interval '1 minute' WHERE id=reservation_id;
        END IF;
        INSERT INTO app.usage_records(workspace_id,user_id,feature_code,quantity,unit,result,idempotency_key,quota_reservation_id,daily_reservation_id)
          VALUES(w,u,'ai_proxy',1,'request','unknown',gen_random_uuid()::text,
            CASE WHEN kind='paid' THEN reservation_id ELSE NULL END,CASE WHEN kind='free' THEN reservation_id ELSE NULL END) RETURNING id INTO usage_id;
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
    END LOOP;
    SELECT granted,reserved,consumed INTO balance FROM app.quota_accounts WHERE id=account_id;
    IF balance.granted<>10 OR balance.reserved<>0 OR balance.consumed<>1 THEN RAISE EXCEPTION '核对后额度不守恒'; END IF;
    SELECT app.reserve_quota(w,'monthly',1,gen_random_uuid()::text,now()+interval '1 minute') INTO reservation_id;
    INSERT INTO app.usage_records(workspace_id,user_id,feature_code,quantity,unit,result,idempotency_key,quota_reservation_id)
      VALUES(other_w,u,'ai_proxy',1,'request','unknown',gen_random_uuid()::text,reservation_id) RETURNING id INTO usage_id;
    BEGIN
      PERFORM app.reconcile_provider_usage(usage_id,'test-admin','released','跨空间测试','test-reference');
      RAISE EXCEPTION '错误允许跨空间';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM<>'额度预占归属或状态异常' THEN RAISE; END IF;
    END;
    IF EXISTS(SELECT 1 FROM app.usage_reconciliations WHERE usage_record_id=usage_id) THEN RAISE EXCEPTION '失败留下审计记录'; END IF;
    RAISE NOTICE 'PASS: 过期预占核对、两类额度结算释放、幂等、相反结论拒绝、审计不可变、跨空间拒绝及额度守恒';
END $$;
ROLLBACK;
