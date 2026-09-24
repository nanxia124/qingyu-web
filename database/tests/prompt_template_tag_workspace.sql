\set ON_ERROR_STOP on
BEGIN;
INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('prompt-workspace-test-' || gen_random_uuid()) RETURNING id \gset user_
INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',:'user_id','提示词空间测试') RETURNING id \gset workspace_a_
INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('prompt-workspace-test-' || gen_random_uuid()) RETURNING id \gset user_b_
INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',:'user_b_id','提示词空间测试B') RETURNING id \gset workspace_b_
INSERT INTO app.prompt_templates(workspace_id,template_key,title,status) VALUES (:'workspace_a_id','template-a','模板 A','active') RETURNING id \gset template_a_
INSERT INTO app.prompt_tags(workspace_id,name) VALUES (:'workspace_a_id','标签 A') RETURNING id \gset tag_a_
INSERT INTO app.prompt_tags(workspace_id,name) VALUES (:'workspace_b_id','标签 B') RETURNING id \gset tag_b_
SELECT set_config('test.template_a', :'template_a_id', true);
SELECT set_config('test.tag_b', :'tag_b_id', true);
INSERT INTO app.prompt_template_tags(template_id,tag_id) VALUES (:'template_a_id',:'tag_a_id');
DO $$
BEGIN
  BEGIN
    INSERT INTO app.prompt_template_tags(template_id,tag_id) VALUES (current_setting('test.template_a')::uuid,current_setting('test.tag_b')::uuid);
    RAISE EXCEPTION '应拒绝跨工作空间模板标签关联';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%提示词模板和标签不属于同一工作空间%' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;
SELECT 'PASS: 提示词模板标签跨工作空间关联被拒绝';
