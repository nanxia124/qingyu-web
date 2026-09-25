-- AI 对话：对话与消息持久化，按 workspace 隔离
BEGIN;
SELECT pg_advisory_xact_lock(70420260926);

CREATE TABLE IF NOT EXISTS app.chat_conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES app.user_accounts(id) ON DELETE CASCADE,
    title varchar(240) NOT NULL DEFAULT '新对话',
    model varchar(160),
    system_prompt text,
    temperature numeric(3,2) NOT NULL DEFAULT 0.70,
    web_search_enabled boolean NOT NULL DEFAULT false,
    summary text,
    share_id varchar(40),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chat_conversations_share_id_unique UNIQUE (share_id)
);

CREATE INDEX IF NOT EXISTS chat_conversations_workspace_updated_idx
    ON app.chat_conversations(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS app.chat_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES app.chat_conversations(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE CASCADE,
    role varchar(16) NOT NULL CHECK (role IN ('user','assistant','system')),
    content text NOT NULL,
    tokens_in integer NOT NULL DEFAULT 0,
    tokens_out integer NOT NULL DEFAULT 0,
    status varchar(24) NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','aborted','failed')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_conversation_created_idx
    ON app.chat_messages(conversation_id, created_at);

CREATE OR REPLACE FUNCTION app.touch_chat_conversation_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS chat_conversations_touch_updated ON app.chat_conversations;
CREATE TRIGGER chat_conversations_touch_updated
BEFORE UPDATE ON app.chat_conversations
FOR EACH ROW EXECUTE FUNCTION app.touch_chat_conversation_updated_at();

ALTER TABLE app.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_conversations_workspace_isolation ON app.chat_conversations;
CREATE POLICY chat_conversations_workspace_isolation ON app.chat_conversations
    FOR ALL USING (app.has_workspace_access(workspace_id))
    WITH CHECK (app.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS chat_messages_workspace_isolation ON app.chat_messages;
CREATE POLICY chat_messages_workspace_isolation ON app.chat_messages
    FOR ALL USING (app.has_workspace_access(workspace_id))
    WITH CHECK (app.has_workspace_access(workspace_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON app.chat_conversations TO qingyu_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.chat_messages TO qingyu_api;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0069_chat_conversations', 'chat-conversations-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
