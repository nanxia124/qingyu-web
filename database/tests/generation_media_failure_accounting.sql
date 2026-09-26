\set ON_ERROR_STOP on
BEGIN;
INSERT INTO app.user_accounts(appwrite_user_id, display_name)
VALUES ('generation-media-accounting-' || gen_random_uuid(), '媒体任务结算测试')
RETURNING id AS uid \gset
INSERT INTO app.workspaces(type, owner_user_id, name)
VALUES ('personal', :'uid', '媒体任务结算测试空间')
RETURNING id AS wid \gset
SELECT set_config('app.user_id', :'uid', true);
SELECT set_config('app.test_workspace_id', :'wid', true);

CREATE TEMP TABLE media_task AS
SELECT * FROM app.create_generation_task(
  :'wid'::uuid, :'uid'::uuid, 'video', 'test', 'test-video-model', 'test-v1',
  'test video', '{}'::jsonb, 1, 'test-video-no-refund', 600
);
CREATE TEMP TABLE timeout_media_task AS
SELECT * FROM app.create_generation_task(
  :'wid'::uuid, :'uid'::uuid, 'audio', 'test', 'test-audio-model', 'test-v1',
  'test audio', '{}'::jsonb, 1, 'test-audio-timeout-no-refund', 600
);

DO $$
DECLARE
  v_task_id uuid;
  v_workspace_id uuid := current_setting('app.test_workspace_id')::uuid;
  v_reservation_id uuid;
  v_usage_id uuid;
  v_attempt_id uuid;
  v_output_id uuid;
  v_file_id uuid;
  v_timeout_task_id uuid;
  v_timeout_reservation_id uuid;
  v_timeout_usage_id uuid;
  v_timeout_attempt_id uuid;
  v_timeout_file_id uuid;
  v_task_status text;
  v_usage_result text;
BEGIN
  SELECT id,quota_reservation_id,usage_record_id
    INTO v_task_id,v_reservation_id,v_usage_id FROM media_task;
  IF v_reservation_id IS NULL THEN RAISE EXCEPTION '媒体任务必须预留积分'; END IF;
  IF (SELECT feature_code FROM app.usage_records WHERE id=v_usage_id) <> 'ai_proxy' THEN
    RAISE EXCEPTION '媒体任务使用记录应属于 ai_proxy';
  END IF;

  PERFORM app.mark_generation_task_running(v_task_id,NULL);
  INSERT INTO app.generation_attempts(workspace_id,task_id,attempt_no,provider)
  VALUES (v_workspace_id,v_task_id,1,'test') RETURNING id INTO v_attempt_id;
  UPDATE app.generation_attempts SET response_complete=true,returned_output_count=1,finished_at=now()
   WHERE id=v_attempt_id;
  PERFORM app.mark_generation_task_saving(v_task_id);

  INSERT INTO app.file_objects(workspace_id,uploaded_by,storage_provider,bucket,object_key,
      mime_type,size_bytes,checksum,status,media_type,source_kind,original_filename,inspection_status)
  VALUES(v_workspace_id,current_setting('app.user_id')::uuid,'cos','test-bucket','test/media.mp4',
      'video/mp4',1024,repeat('a',64),'pending','video','generated','generated-video.mp4','approved')
    RETURNING id INTO v_file_id;
  INSERT INTO app.generation_outputs(workspace_id,task_id,output_index,output_type,attempt_id,file_id,availability)
  VALUES(v_workspace_id,v_task_id,0,'video',v_attempt_id,v_file_id,'awaiting') RETURNING id INTO v_output_id;

  PERFORM app.fail_generation_task_keep_charge(v_task_id,'output_unrecoverable','simulated storage failure');
  PERFORM app.fail_generation_task_keep_charge(v_task_id,'output_unrecoverable','duplicate retry');

  SELECT status INTO v_task_status FROM app.generation_tasks WHERE id=v_task_id;
  SELECT result INTO v_usage_result FROM app.usage_records WHERE id=v_usage_id;
  IF v_task_status <> 'failed' OR v_usage_result <> 'committed' THEN
    RAISE EXCEPTION '无法恢复的已生成媒体必须标记失败并保留扣费：task %, usage %',v_task_status,v_usage_result;
  END IF;
  IF (SELECT status FROM app.quota_reservations WHERE id=v_reservation_id) <> 'committed' THEN
    RAISE EXCEPTION '无法恢复的媒体结果不应释放积分预留';
  END IF;
  IF (SELECT availability FROM app.generation_outputs WHERE id=v_output_id) <> 'unavailable' THEN
    RAISE EXCEPTION '无法恢复的媒体输出应标记为不可用';
  END IF;
  IF (SELECT status FROM app.file_objects WHERE id=v_file_id) <> 'failed' THEN
    RAISE EXCEPTION '无法恢复的媒体文件应标记失败';
  END IF;

  SELECT id,quota_reservation_id,usage_record_id INTO v_timeout_task_id,v_timeout_reservation_id,v_timeout_usage_id FROM timeout_media_task;
  PERFORM app.mark_generation_task_running(v_timeout_task_id,NULL);
  INSERT INTO app.generation_attempts(workspace_id,task_id,attempt_no,provider,response_complete,returned_output_count,finished_at)
  VALUES(v_workspace_id,v_timeout_task_id,1,'test',true,1,now()) RETURNING id INTO v_timeout_attempt_id;
  INSERT INTO app.file_objects(workspace_id,uploaded_by,storage_provider,bucket,object_key,mime_type,status,media_type,source_kind,original_filename,inspection_status)
  VALUES(v_workspace_id,current_setting('app.user_id')::uuid,'cos','test-bucket','test/audio-timeout.mp3',
      'audio/mpeg','pending','audio','generated','audio.mp3','approved') RETURNING id INTO v_timeout_file_id;
  INSERT INTO app.generation_outputs(workspace_id,task_id,output_index,output_type,attempt_id,file_id,availability)
  VALUES(v_workspace_id,v_timeout_task_id,0,'audio',v_timeout_attempt_id,v_timeout_file_id,'awaiting');
  PERFORM app.mark_generation_task_saving(v_timeout_task_id);
  UPDATE app.generation_tasks SET timeout_at=now()-interval '1 second' WHERE id=v_timeout_task_id;
  IF app.reap_stale_generation_output_tasks() <> 1 THEN RAISE EXCEPTION '过期的媒体保存任务应被自动结算'; END IF;
  IF (SELECT status FROM app.quota_reservations WHERE id=v_timeout_reservation_id) <> 'committed'
     OR (SELECT result FROM app.usage_records WHERE id=v_timeout_usage_id) <> 'committed' THEN
    RAISE EXCEPTION '已生成但保存超时的媒体不应被自动退费';
  END IF;
  RAISE NOTICE 'PASS: 媒体任务按积分计费；保存不可恢复时失败留档、扣费结算且重复处理不重复记账';
END $$;
ROLLBACK;
