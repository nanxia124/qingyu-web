\set ON_ERROR_STOP on
BEGIN;
INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('org-test-a-' || gen_random_uuid()) RETURNING id \gset org_a_
INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('org-test-b-' || gen_random_uuid()) RETURNING id \gset org_b_
INSERT INTO app.teams(name,slug,owner_user_id) VALUES ('组织测试','org-' || gen_random_uuid(),:'org_a_id') RETURNING id \gset org_team_
INSERT INTO app.workspaces(type,team_id,name) VALUES ('team',:'org_team_id','组织空间') RETURNING id \gset org_space_
INSERT INTO app.team_memberships(team_id,user_id,status,joined_at) VALUES (:'org_team_id',:'org_a_id','active',now());
INSERT INTO app.role_bindings(workspace_id,user_id,role_id) VALUES (:'org_space_id',:'org_a_id',(SELECT id FROM app.roles WHERE code='owner'));
SELECT set_config('org.space',:'org_space_id',false), set_config('org.b',:'org_b_id',false);
DO $$
BEGIN
  BEGIN
    INSERT INTO app.role_bindings(workspace_id,user_id,role_id) VALUES (current_setting('org.space')::uuid,current_setting('org.b')::uuid,(SELECT id FROM app.roles WHERE code='viewer'));
    RAISE EXCEPTION '非团队成员仍可绑定角色';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '团队空间角色只能绑定给团队成员' THEN RAISE; END IF;
  END;
END $$;
INSERT INTO app.departments(team_id,name) VALUES (:'org_team_id','总部') RETURNING id \gset dept_a_
INSERT INTO app.departments(team_id,parent_id,name) VALUES (:'org_team_id',:'dept_a_id','设计部') RETURNING id \gset dept_b_
SELECT set_config('org.dept_a',:'dept_a_id',false), set_config('org.dept_b',:'dept_b_id',false);
DO $$
BEGIN
  BEGIN
    UPDATE app.departments SET parent_id=current_setting('org.dept_b',true)::uuid WHERE id=current_setting('org.dept_a',true)::uuid;
    RAISE EXCEPTION '部门环未被拒绝';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '部门层级不能形成环' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;
