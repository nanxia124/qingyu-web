-- 模板和标签分别属于工作空间时，连接表也必须阻止跨空间关联。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE OR REPLACE FUNCTION app.validate_prompt_template_tag_workspace()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE template_workspace uuid; tag_workspace uuid;
BEGIN
    SELECT workspace_id INTO template_workspace FROM app.prompt_templates WHERE id=NEW.template_id;
    SELECT workspace_id INTO tag_workspace FROM app.prompt_tags WHERE id=NEW.tag_id;
    IF template_workspace IS DISTINCT FROM tag_workspace THEN
        RAISE EXCEPTION '提示词模板和标签不属于同一工作空间';
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS prompt_template_tag_workspace_guard ON app.prompt_template_tags;
CREATE CONSTRAINT TRIGGER prompt_template_tag_workspace_guard
AFTER INSERT OR UPDATE ON app.prompt_template_tags
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.validate_prompt_template_tag_workspace();

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0035_prompt_template_tag_workspace', 'prompt-template-tag-workspace-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
