-- 修正提示词关联触发器：不同表使用各自的 NEW 字段，避免合法标签写入报错。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE OR REPLACE FUNCTION app.validate_prompt_template_source()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.source_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM app.prompt_sources s
        WHERE s.id = NEW.source_id
          AND s.workspace_id IS NOT NULL
          AND s.workspace_id IS DISTINCT FROM NEW.workspace_id
    ) THEN
        RAISE EXCEPTION '提示词模板和来源不属于同一工作空间';
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.validate_prompt_template_tag()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE template_workspace uuid; tag_workspace uuid;
BEGIN
    SELECT workspace_id INTO template_workspace FROM app.prompt_templates WHERE id = NEW.template_id;
    SELECT workspace_id INTO tag_workspace FROM app.prompt_tags WHERE id = NEW.tag_id;
    IF tag_workspace IS NOT NULL AND tag_workspace IS DISTINCT FROM template_workspace THEN
        RAISE EXCEPTION '提示词模板和标签不属于同一工作空间';
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS prompt_templates_workspace_link ON app.prompt_templates;
CREATE TRIGGER prompt_templates_workspace_link
BEFORE INSERT OR UPDATE OF workspace_id, source_id ON app.prompt_templates
FOR EACH ROW EXECUTE FUNCTION app.validate_prompt_template_source();
DROP TRIGGER IF EXISTS prompt_template_tags_workspace_link ON app.prompt_template_tags;
CREATE TRIGGER prompt_template_tags_workspace_link
BEFORE INSERT OR UPDATE OF template_id, tag_id ON app.prompt_template_tags
FOR EACH ROW EXECUTE FUNCTION app.validate_prompt_template_tag();
DROP FUNCTION app.validate_prompt_workspace_links();

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0016_prompt_link_trigger_fix', 'prompt-link-trigger-fix-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
