-- 业务表行级安全策略
-- 应用事务在完成 Appwrite 身份校验后设置：
-- SET LOCAL app.user_id = '<内部 user_accounts.id>';
-- 该值只在当前事务有效，连接池复用时不会跨请求残留。
BEGIN;

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
    SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app.has_workspace_access(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM app.workspaces w
        WHERE w.id = p_workspace_id
          AND w.status = 'active'
          AND (
              (w.type = 'personal' AND w.owner_user_id = app.current_user_id())
              OR
              (w.type = 'team' AND EXISTS (
                  SELECT 1 FROM app.team_memberships tm
                  WHERE tm.team_id = w.team_id
                    AND tm.user_id = app.current_user_id()
                    AND tm.status = 'active'
              ))
          )
    );
$$;

REVOKE ALL ON FUNCTION app.current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.has_workspace_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_user_id() TO qingyu_app;
GRANT EXECUTE ON FUNCTION app.has_workspace_access(uuid) TO qingyu_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'permission_overrides','access_policies','subscriptions',
    'payment_customers','orders','usage_records','quota_grants','file_objects',
    'generation_tasks','generation_outputs','assets','asset_versions','asset_files',
    'collections','ai_channels','notifications','canvas_projects','canvas_nodes',
    'canvas_connections','canvas_chat_sessions','canvas_chat_messages',
    'agent_threads','agent_messages','agent_event_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS workspace_isolation ON app.%I', t);
    EXECUTE format(
      'CREATE POLICY workspace_isolation ON app.%I USING (app.has_workspace_access(workspace_id)) WITH CHECK (app.has_workspace_access(workspace_id))',
      t
    );
  END LOOP;
END $$;

ALTER TABLE app.workspaces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_self_isolation ON app.workspaces;
CREATE POLICY workspace_self_isolation ON app.workspaces
USING (app.has_workspace_access(id))
WITH CHECK (app.has_workspace_access(id));

ALTER TABLE app.team_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_invitation_isolation ON app.team_invitations;
CREATE POLICY team_invitation_isolation ON app.team_invitations
USING (EXISTS (SELECT 1 FROM app.teams t JOIN app.workspaces w ON w.team_id=t.id WHERE t.id=team_invitations.team_id AND app.has_workspace_access(w.id)))
WITH CHECK (EXISTS (SELECT 1 FROM app.teams t JOIN app.workspaces w ON w.team_id=t.id WHERE t.id=team_invitations.team_id AND app.has_workspace_access(w.id)));

ALTER TABLE app.role_bindings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_binding_isolation ON app.role_bindings;
CREATE POLICY role_binding_isolation ON app.role_bindings
USING (app.has_workspace_access(workspace_id))
WITH CHECK (app.has_workspace_access(workspace_id));

ALTER TABLE app.asset_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asset_share_isolation ON app.asset_shares;
CREATE POLICY asset_share_isolation ON app.asset_shares
USING (EXISTS (SELECT 1 FROM app.assets a WHERE a.id=asset_shares.asset_id AND app.has_workspace_access(a.workspace_id)))
WITH CHECK (EXISTS (SELECT 1 FROM app.assets a WHERE a.id=asset_shares.asset_id AND app.has_workspace_access(a.workspace_id)));

ALTER TABLE app.asset_references ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asset_reference_isolation ON app.asset_references;
CREATE POLICY asset_reference_isolation ON app.asset_references
USING (EXISTS (SELECT 1 FROM app.assets a WHERE a.id=asset_references.target_asset_id AND app.has_workspace_access(a.workspace_id)))
WITH CHECK (EXISTS (SELECT 1 FROM app.assets a WHERE a.id=asset_references.target_asset_id AND app.has_workspace_access(a.workspace_id)));

ALTER TABLE app.collection_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS collection_item_isolation ON app.collection_items;
CREATE POLICY collection_item_isolation ON app.collection_items
USING (EXISTS (SELECT 1 FROM app.collections c WHERE c.id=collection_items.collection_id AND app.has_workspace_access(c.workspace_id)))
WITH CHECK (EXISTS (SELECT 1 FROM app.collections c WHERE c.id=collection_items.collection_id AND app.has_workspace_access(c.workspace_id)));

ALTER TABLE app.asset_likes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asset_like_isolation ON app.asset_likes;
CREATE POLICY asset_like_isolation ON app.asset_likes
USING (EXISTS (SELECT 1 FROM app.assets a WHERE a.id=asset_likes.asset_id AND app.has_workspace_access(a.workspace_id)))
WITH CHECK (EXISTS (SELECT 1 FROM app.assets a WHERE a.id=asset_likes.asset_id AND app.has_workspace_access(a.workspace_id)));

ALTER TABLE app.asset_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asset_comment_isolation ON app.asset_comments;
CREATE POLICY asset_comment_isolation ON app.asset_comments
USING (EXISTS (SELECT 1 FROM app.assets a WHERE a.id=asset_comments.asset_id AND app.has_workspace_access(a.workspace_id)))
WITH CHECK (EXISTS (SELECT 1 FROM app.assets a WHERE a.id=asset_comments.asset_id AND app.has_workspace_access(a.workspace_id)));

ALTER TABLE app.moderation_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS moderation_isolation ON app.moderation_records;
CREATE POLICY moderation_isolation ON app.moderation_records
USING (EXISTS (
  SELECT 1 FROM app.assets a WHERE a.id=moderation_records.asset_id AND app.has_workspace_access(a.workspace_id)
  UNION ALL
  SELECT 1 FROM app.asset_comments c JOIN app.assets a ON a.id=c.asset_id
  WHERE c.id=moderation_records.comment_id AND app.has_workspace_access(a.workspace_id)
))
WITH CHECK (EXISTS (
  SELECT 1 FROM app.assets a WHERE a.id=moderation_records.asset_id AND app.has_workspace_access(a.workspace_id)
  UNION ALL
  SELECT 1 FROM app.asset_comments c JOIN app.assets a ON a.id=c.asset_id
  WHERE c.id=moderation_records.comment_id AND app.has_workspace_access(a.workspace_id)
));

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0006_row_level_security', 'row-level-security-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
