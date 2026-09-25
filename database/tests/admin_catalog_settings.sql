BEGIN;
DO $$
DECLARE
    inserted_id bigint;
    channel_id uuid;
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

    INSERT INTO app.platform_api_keys(name, provider, base_url, model)
    VALUES ('测试渠道', 'openai', 'https://example.invalid/v1', 'upstream-image-test')
    RETURNING id INTO channel_id;
    INSERT INTO app.model_catalog(display_name, capability)
    VALUES ('目录展示名测试', 'image')
    RETURNING id INTO inserted_id;
    IF (SELECT model_id FROM app.model_catalog WHERE id=inserted_id) IS NOT NULL THEN
        RAISE EXCEPTION '新目录模型不应要求手填 model_id';
    END IF;
    INSERT INTO app.model_catalog_channel_models(model_catalog_id, platform_api_key_id, upstream_model_id)
    VALUES (inserted_id, channel_id, 'upstream-image-test');
    IF NOT EXISTS (
        SELECT 1 FROM app.model_catalog_channel_models
        WHERE model_catalog_id=inserted_id AND platform_api_key_id=channel_id AND upstream_model_id='upstream-image-test'
    ) THEN
        RAISE EXCEPTION '目录模型与渠道真实模型关联失败';
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
    RAISE NOTICE 'PASS: 目录模型无需手填 model_id，可持久化绑定渠道模型；旧 model_id 唯一规则和系统设置正常';
END $$;
ROLLBACK;
