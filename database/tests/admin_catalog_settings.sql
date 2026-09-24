BEGIN;
DO $$
DECLARE
    inserted_id bigint;
BEGIN
    INSERT INTO app.model_catalog(model_id, display_name, provider, capability, sort_order)
    VALUES ('test-model', '测试模型', 'test', 'image', 1)
    RETURNING id INTO inserted_id;

    IF NOT EXISTS (SELECT 1 FROM app.model_catalog mc WHERE mc.id = inserted_id AND mc.visible = true) THEN
        RAISE EXCEPTION '模型目录写入失败';
    END IF;
    IF EXISTS (SELECT 1 FROM app.model_catalog WHERE model_id = 'test-model' AND provider <> 'test') THEN
        RAISE EXCEPTION '模型目录字段不一致';
    END IF;

    INSERT INTO app.system_settings(setting_key, setting_value)
    VALUES ('test.settings', '{"enabled":true}'::jsonb);
    UPDATE app.system_settings SET setting_value = '{"enabled":false}'::jsonb WHERE setting_key = 'test.settings';
    IF (SELECT setting_value->>'enabled' FROM app.system_settings WHERE setting_key = 'test.settings') <> 'false' THEN
        RAISE EXCEPTION '系统设置更新失败';
    END IF;

    BEGIN
        INSERT INTO app.model_catalog(model_id, display_name) VALUES ('test-model', '重复模型');
        RAISE EXCEPTION '重复模型没有被拒绝';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;
    RAISE NOTICE 'PASS: 模型目录和系统设置可写入、更新并拒绝重复模型';
END $$;
ROLLBACK;
