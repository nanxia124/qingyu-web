-- 验证提示词来源、模板和标签不会跨工作空间串联。
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  ua uuid; ub uuid; wa uuid; wb uuid; source_a uuid; template_a uuid; template_b uuid; tag_b uuid;
BEGIN
  INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('prompt-test-' || gen_random_uuid()) RETURNING id INTO ua;
  INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('prompt-test-' || gen_random_uuid()) RETURNING id INTO ub;
  INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',ua,'提示词 A') RETURNING id INTO wa;
  INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',ub,'提示词 B') RETURNING id INTO wb;
  INSERT INTO app.prompt_sources(workspace_id,source_type) VALUES (wa,'manual') RETURNING id INTO source_a;
  INSERT INTO app.prompt_templates(workspace_id,source_id,template_key,title)
  VALUES (wa,source_a,'a','A') RETURNING id INTO template_a;
  INSERT INTO app.prompt_templates(workspace_id,template_key,title)
  VALUES (wb,'b','B') RETURNING id INTO template_b;
  BEGIN
    UPDATE app.prompt_templates SET source_id=source_a WHERE id=template_b;
    RAISE EXCEPTION '未拒绝跨空间提示词来源';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%同一工作空间%' THEN RAISE; END IF;
  END;
  INSERT INTO app.prompt_tags(workspace_id,name) VALUES (wb,'B 标签') RETURNING id INTO tag_b;
  BEGIN
    INSERT INTO app.prompt_template_tags(template_id,tag_id) VALUES (template_a,tag_b);
    RAISE EXCEPTION '未拒绝跨空间提示词标签';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%同一工作空间%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: 跨空间提示词来源和标签关联被拒绝';
END $$;
ROLLBACK;
