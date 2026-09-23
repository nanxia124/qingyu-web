\set ON_ERROR_STOP on
BEGIN;
INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('agent-test-' || gen_random_uuid()) RETURNING id \gset agent_user_
INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',:'agent_user_id','Agent 测试空间') RETURNING id \gset agent_space_
INSERT INTO app.agent_threads(workspace_id,user_id,title) VALUES (:'agent_space_id',:'agent_user_id','测试线程') RETURNING id \gset agent_thread_
INSERT INTO app.agent_turns(thread_id,workspace_id,turn_key,idempotency_key,request_hash)
VALUES (:'agent_thread_id',:'agent_space_id','turn-1','agent-turn-1','hash-a') RETURNING id \gset agent_turn_
INSERT INTO app.agent_approvals(turn_id,workspace_id,request_key,action_type,input_hash,expires_at)
VALUES (:'agent_turn_id',:'agent_space_id','approval-1','shell.exec','hash-command',now()+interval '10 minutes');
INSERT INTO app.agent_tool_calls(turn_id,workspace_id,call_key,tool_name,input_hash)
VALUES (:'agent_turn_id',:'agent_space_id','tool-1','shell.exec','hash-tool');
SELECT set_config('agent.thread', :'agent_thread_id', false);
SELECT set_config('agent.space', :'agent_space_id', false);
DO $$
BEGIN
  BEGIN
    INSERT INTO app.agent_turns(thread_id,workspace_id,turn_key,idempotency_key,request_hash)
    VALUES (current_setting('agent.thread')::uuid,current_setting('agent.space')::uuid,'turn-1','agent-turn-duplicate','hash-b');
    RAISE EXCEPTION '重复轮次未被拒绝';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
ROLLBACK;
