-- 补齐互动资源、分享、审核和提示词关联的空间边界。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

-- 这些表以前通过单列外键关联资源，数据库无法阻止把 A 空间的资源挂到 B 空间的容器上。
ALTER TABLE app.collections ADD CONSTRAINT collections_id_workspace_key UNIQUE (id, workspace_id);

ALTER TABLE app.collection_items ADD COLUMN workspace_id uuid;
UPDATE app.collection_items ci
SET workspace_id = c.workspace_id
FROM app.collections c
WHERE c.id = ci.collection_id;
ALTER TABLE app.collection_items ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE app.collection_items ADD CONSTRAINT collection_items_collection_workspace_fk
    FOREIGN KEY (collection_id, workspace_id) REFERENCES app.collections(id, workspace_id) ON DELETE CASCADE;
ALTER TABLE app.collection_items ADD CONSTRAINT collection_items_asset_workspace_fk
    FOREIGN KEY (asset_id, workspace_id) REFERENCES app.assets(id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE app.asset_references ADD COLUMN workspace_id uuid;
UPDATE app.asset_references ar
SET workspace_id = a.workspace_id
FROM app.assets a
WHERE a.id = ar.source_asset_id;
ALTER TABLE app.asset_references ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE app.asset_references ADD CONSTRAINT asset_references_source_workspace_fk
    FOREIGN KEY (source_asset_id, workspace_id) REFERENCES app.assets(id, workspace_id) ON DELETE RESTRICT;
ALTER TABLE app.asset_references ADD CONSTRAINT asset_references_target_workspace_fk
    FOREIGN KEY (target_asset_id, workspace_id) REFERENCES app.assets(id, workspace_id) ON DELETE RESTRICT;
ALTER TABLE app.asset_references ADD CONSTRAINT asset_references_not_self CHECK (source_asset_id <> target_asset_id);

ALTER TABLE app.asset_likes ADD COLUMN workspace_id uuid;
UPDATE app.asset_likes al
SET workspace_id = a.workspace_id
FROM app.assets a
WHERE a.id = al.asset_id;
ALTER TABLE app.asset_likes ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE app.asset_likes ADD CONSTRAINT asset_likes_asset_workspace_fk
    FOREIGN KEY (asset_id, workspace_id) REFERENCES app.assets(id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE app.asset_comments ADD COLUMN workspace_id uuid;
UPDATE app.asset_comments ac
SET workspace_id = a.workspace_id
FROM app.assets a
WHERE a.id = ac.asset_id;
ALTER TABLE app.asset_comments ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE app.asset_comments ADD CONSTRAINT asset_comments_id_workspace_key UNIQUE (id, workspace_id);
ALTER TABLE app.asset_comments ADD CONSTRAINT asset_comments_asset_workspace_fk
    FOREIGN KEY (asset_id, workspace_id) REFERENCES app.assets(id, workspace_id) ON DELETE RESTRICT;
ALTER TABLE app.asset_comments ADD CONSTRAINT asset_comments_parent_workspace_fk
    FOREIGN KEY (parent_id, workspace_id) REFERENCES app.asset_comments(id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE app.asset_shares ADD COLUMN workspace_id uuid;
UPDATE app.asset_shares ash
SET workspace_id = a.workspace_id
FROM app.assets a
WHERE a.id = ash.asset_id;
ALTER TABLE app.asset_shares ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE app.asset_shares ADD CONSTRAINT asset_shares_asset_workspace_fk
    FOREIGN KEY (asset_id, workspace_id) REFERENCES app.assets(id, workspace_id) ON DELETE RESTRICT;
ALTER TABLE app.asset_shares ADD CONSTRAINT asset_shares_public_link_target_check
    CHECK ((target_type = 'public_link' AND target_id IS NULL) OR (target_type <> 'public_link' AND target_id IS NOT NULL));

ALTER TABLE app.moderation_records ADD COLUMN workspace_id uuid;
UPDATE app.moderation_records mr
SET workspace_id = a.workspace_id
FROM app.assets a
WHERE mr.asset_id = a.id;
UPDATE app.moderation_records mr
SET workspace_id = a.workspace_id
FROM app.asset_comments c
JOIN app.assets a ON a.id = c.asset_id
WHERE mr.comment_id = c.id AND mr.workspace_id IS NULL;
ALTER TABLE app.moderation_records ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE app.moderation_records ADD CONSTRAINT moderation_records_asset_workspace_fk
    FOREIGN KEY (asset_id, workspace_id) REFERENCES app.assets(id, workspace_id) ON DELETE RESTRICT;
ALTER TABLE app.moderation_records ADD CONSTRAINT moderation_records_comment_workspace_fk
    FOREIGN KEY (comment_id, workspace_id) REFERENCES app.asset_comments(id, workspace_id) ON DELETE RESTRICT;

CREATE INDEX collection_items_workspace_idx ON app.collection_items(workspace_id, collection_id);
CREATE INDEX asset_references_workspace_idx ON app.asset_references(workspace_id, source_asset_id);
CREATE INDEX asset_likes_workspace_idx ON app.asset_likes(workspace_id, asset_id);
CREATE INDEX asset_comments_workspace_idx ON app.asset_comments(workspace_id, asset_id, created_at);
CREATE INDEX asset_shares_workspace_idx ON app.asset_shares(workspace_id, asset_id);
CREATE INDEX moderation_records_workspace_idx ON app.moderation_records(workspace_id, created_at);

-- 用统一的 workspace_id 做 RLS 判断，避免只检查其中一个资源导致跨空间引用漏过。
DROP POLICY IF EXISTS asset_reference_isolation ON app.asset_references;
CREATE POLICY asset_reference_isolation ON app.asset_references
USING (app.has_workspace_access(workspace_id))
WITH CHECK (app.has_workspace_access(workspace_id));
DROP POLICY IF EXISTS collection_item_isolation ON app.collection_items;
CREATE POLICY collection_item_isolation ON app.collection_items
USING (app.has_workspace_access(workspace_id))
WITH CHECK (app.has_workspace_access(workspace_id));
DROP POLICY IF EXISTS asset_like_isolation ON app.asset_likes;
CREATE POLICY asset_like_isolation ON app.asset_likes
USING (app.has_workspace_access(workspace_id))
WITH CHECK (app.has_workspace_access(workspace_id));
DROP POLICY IF EXISTS asset_comment_isolation ON app.asset_comments;
CREATE POLICY asset_comment_isolation ON app.asset_comments
USING (app.has_workspace_access(workspace_id))
WITH CHECK (app.has_workspace_access(workspace_id));
DROP POLICY IF EXISTS asset_share_isolation ON app.asset_shares;
CREATE POLICY asset_share_isolation ON app.asset_shares
USING (app.has_workspace_access(workspace_id))
WITH CHECK (app.has_workspace_access(workspace_id));
DROP POLICY IF EXISTS moderation_isolation ON app.moderation_records;
CREATE POLICY moderation_isolation ON app.moderation_records
USING (app.has_workspace_access(workspace_id))
WITH CHECK (app.has_workspace_access(workspace_id));

-- 提示词可以是全局的（workspace_id 为空），但一旦带空间，就只能引用同空间资源。
CREATE OR REPLACE FUNCTION app.validate_prompt_workspace_links()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE template_workspace uuid; tag_workspace uuid;
BEGIN
    IF TG_TABLE_NAME = 'prompt_templates' AND NEW.source_id IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM app.prompt_sources s
            WHERE s.id = NEW.source_id
              AND s.workspace_id IS NOT NULL
              AND s.workspace_id IS DISTINCT FROM NEW.workspace_id
        ) THEN
            RAISE EXCEPTION '提示词模板和来源不属于同一工作空间';
        END IF;
    ELSIF TG_TABLE_NAME = 'prompt_template_tags' THEN
        SELECT workspace_id INTO template_workspace FROM app.prompt_templates WHERE id = NEW.template_id;
        SELECT workspace_id INTO tag_workspace FROM app.prompt_tags WHERE id = NEW.tag_id;
        IF tag_workspace IS NOT NULL AND tag_workspace IS DISTINCT FROM template_workspace THEN
            RAISE EXCEPTION '提示词模板和标签不属于同一工作空间';
        END IF;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS prompt_templates_workspace_link ON app.prompt_templates;
CREATE TRIGGER prompt_templates_workspace_link
BEFORE INSERT OR UPDATE OF workspace_id, source_id ON app.prompt_templates
FOR EACH ROW EXECUTE FUNCTION app.validate_prompt_workspace_links();
DROP TRIGGER IF EXISTS prompt_template_tags_workspace_link ON app.prompt_template_tags;
CREATE TRIGGER prompt_template_tags_workspace_link
BEFORE INSERT OR UPDATE OF template_id, tag_id ON app.prompt_template_tags
FOR EACH ROW EXECUTE FUNCTION app.validate_prompt_workspace_links();

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0015_workspace_link_integrity', 'workspace-link-integrity-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
