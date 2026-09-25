import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { createPostgresBillingStore } from './postgres-billing-store.mjs';

assert.equal(process.env.PGDATABASE, 'qingyu_canvas_verify', '测试只允许连接隔离数据库 qingyu_canvas_verify');

const store = await createPostgresBillingStore();
const inspection = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGINSPECTUSER || process.env.PGUSER || 'user',
  password: process.env.PGINSPECTPASSWORD || process.env.PGPASSWORD,
});
const suffix = crypto.randomUUID();
const userA = `asset-link-a-${suffix}`;
const userB = `asset-link-b-${suffix}`;
const projectId = `asset-link-project-${suffix}`;

function snapshot(serverVersion, storageKey, id = projectId) {
  return {
    projects: [{
      id,
      ...(serverVersion ? { serverVersion } : {}),
      title: '素材关联验证',
      nodes: [{ id: 'image-node', type: 'image', title: '测试图片', metadata: { storageKey } }],
      connections: [], chatSessions: [], backgroundMode: 'lines', showImageInfo: false,
      viewport: { x: 0, y: 0, k: 1 },
    }],
    deletedProjects: [],
  };
}

async function createTestAsset(userId, workspaceId, name) {
  return store.createAssetFromFile(userId, {
    storageProvider: 'cos', bucket: 'qingyu-test-assets',
    objectKey: `workspaces/${workspaceId}/uploads/images/test/${crypto.randomUUID()}.png`,
    fileId: crypto.randomUUID(), uploadBatchId: crypto.randomUUID(), workspaceId,
    title: name, originalFilename: `${name}.png`, assetType: 'image', mediaType: 'image', sourceKind: 'manual_upload',
    mimeType: 'image/png', sizeBytes: 4, checksum: crypto.randomBytes(32).toString('hex'),
  });
}

try {
  await store.ensureUser(userA, `${userA}@example.invalid`);
  await store.ensureUser(userB, `${userB}@example.invalid`);
  const scopeA = await store.getAssetUploadScope(userA);
  const scopeB = await store.getAssetUploadScope(userB);
  const assetA = await createTestAsset(userA, scopeA.workspaceId, '同空间素材');
  const assetA2 = await createTestAsset(userA, scopeA.workspaceId, '另一个同空间素材');
  const assetB = await createTestAsset(userB, scopeB.workspaceId, '其他空间素材');

  const editInput = { idempotencyKey: `content-edit-${suffix}`, referenceAssetIds: [assetA.id] };
  const edit = await store.createContentEdit(userA, editInput);
  const editRetry = await store.createContentEdit(userA, editInput);
  assert.equal(editRetry.editId, edit.editId, '编辑幂等重试应复用同一条编辑记录');
  assert.equal(editRetry.baseFileId, edit.baseFileId);
  await assert.rejects(store.createContentEdit(userA, { ...editInput, referenceAssetIds: [assetA2.id] }), /不能更换参考素材/);
  await assert.rejects(store.createContentEdit(userA, { ...editInput, referenceAssetIds: [assetB.id] }), /不属于当前工作空间/);

  const editedFileId = crypto.randomUUID();
  const editResultChecksum = crypto.randomBytes(32).toString('hex');
  const writeIdempotencyKey = `image-tool:${suffix}`;
  const editedAssetInput = {
    storageProvider: 'cos', bucket: 'qingyu-test-assets',
    objectKey: `workspaces/${scopeA.workspaceId}/edits/images/2026/09/${edit.editId}/${editedFileId}.png`,
    fileId: editedFileId, workspaceId: scopeA.workspaceId, title: '编辑结果', originalFilename: 'edited.png',
    assetType: 'image', mediaType: 'image', sourceKind: 'edited', mimeType: 'image/png', sizeBytes: 4,
    checksum: editResultChecksum, idempotencyKey: writeIdempotencyKey,
    metadata: { sourceKind: 'edited', editId: edit.editId, sourceFileId: edit.baseFileId, writeIdempotencyKey },
  };
  const editedAsset = await store.createAssetFromFile(userA, editedAssetInput);
  const retriedEditedAsset = await store.createAssetFromFile(userA, {
    ...editedAssetInput, fileId: crypto.randomUUID(),
    objectKey: `workspaces/${scopeA.workspaceId}/edits/images/2026/09/${edit.editId}/${crypto.randomUUID()}.png`,
  });
  assert.equal(retriedEditedAsset.id, editedAsset.id, '相同幂等键和内容应复用已保存资产');
  assert.equal(retriedEditedAsset.reused, true);
  await assert.rejects(store.createAssetFromFile(userA, {
    ...editedAssetInput, fileId: crypto.randomUUID(), checksum: crypto.randomBytes(32).toString('hex'),
    objectKey: `workspaces/${scopeA.workspaceId}/edits/images/2026/09/${edit.editId}/${crypto.randomUUID()}.png`,
  }), /不能用于不同内容或来源/);
  const idempotencyCount = await inspection.query(`select count(*)::int count from app.file_objects where workspace_id=$1 and write_idempotency_key=$2`, [scopeA.workspaceId, writeIdempotencyKey]);
  assert.equal(idempotencyCount.rows[0].count, 1, '幂等重试只能登记一个文件对象');
  const editedFile = await inspection.query(`select f.source_kind,f.edit_id,f.source_file_id,cei.file_id base_file_id
    from app.assets a join app.asset_versions av on av.asset_id=a.id and av.workspace_id=a.workspace_id
    join app.asset_files af on af.asset_version_id=av.id and af.workspace_id=av.workspace_id and af.role='source'
    join app.file_objects f on f.id=af.file_id and f.workspace_id=af.workspace_id
    join app.content_edit_inputs cei on cei.edit_id=f.edit_id and cei.workspace_id=f.workspace_id and cei.role='base'
    where a.id=$1`, [editedAsset.id]);
  assert.equal(editedFile.rowCount, 1, '编辑结果应可追溯到编辑记录及原文件');
  assert.equal(editedFile.rows[0].source_kind, 'edited');
  assert.equal(String(editedFile.rows[0].edit_id), edit.editId);
  assert.equal(String(editedFile.rows[0].source_file_id), edit.baseFileId);
  assert.equal(String(editedFile.rows[0].base_file_id), edit.baseFileId);
  const pendingEditedFileId = crypto.randomUUID();
  const editUpload = await store.createAssetUploadSession(userA, {
    title: 'large-edited-result.png', mimeType: 'image/png', sizeBytes: 16 * 1024 * 1024,
    sourceKind: 'edited', mediaType: 'image', bucket: 'qingyu-test-assets',
    objectKey: `workspaces/${scopeA.workspaceId}/edits/images/2026/09/${edit.editId}/${pendingEditedFileId}.png`,
    fileId: pendingEditedFileId, providerUploadId: `test-upload-${suffix}`, editId: edit.editId, sourceFileId: edit.baseFileId,
  });
  const pendingEdited = await inspection.query(`select source_kind,edit_id,source_file_id from app.file_objects where id=$1`, [pendingEditedFileId]);
  assert.equal(pendingEdited.rows[0].source_kind, 'edited');
  assert.equal(String(pendingEdited.rows[0].edit_id), edit.editId);
  assert.equal(String(pendingEdited.rows[0].source_file_id), edit.baseFileId);
  await store.failAssetUploadSession(userA, editUpload.sessionId, 'test_abort');

  const firstSave = await store.saveCanvasSnapshot(userA, snapshot(undefined, `image:${assetA.id}`));
  assert.equal(firstSave.versions[0].serverVersion, 1);
  let project = await inspection.query(`select id from app.canvas_projects where workspace_id=$1 and external_key=$2`, [scopeA.workspaceId, projectId]);
  assert.equal(project.rowCount, 1);
  const initialLink = await inspection.query(`select cpa.asset_id,cpa.asset_version_id,af.file_id
    from app.canvas_project_assets cpa
    join app.asset_files af on af.asset_version_id=cpa.asset_version_id and af.workspace_id=cpa.workspace_id and af.role='source'
    where cpa.project_id=$1 and cpa.workspace_id=$2`, [project.rows[0].id, scopeA.workspaceId]);
  assert.equal(initialLink.rowCount, 1, '画布保存应登记素材关联');
  assert.equal(String(initialLink.rows[0].asset_id), assetA.id);
  const initialNodeUse = await inspection.query(`select cnu.asset_id,cnu.asset_version_id,cnu.file_id,cnu.slot_key
    from app.canvas_node_asset_uses cnu join app.canvas_nodes cn on cn.id=cnu.node_id and cn.project_id=cnu.project_id
    where cnu.project_id=$1 and cn.node_key='image-node'`, [project.rows[0].id]);
  assert.equal(initialNodeUse.rowCount, 1, '画布应记录节点具体使用的素材');
  assert.equal(String(initialNodeUse.rows[0].asset_id), assetA.id);
  assert.equal(initialNodeUse.rows[0].slot_key, 'metadata.storageKey');
  assert.equal(String(initialNodeUse.rows[0].asset_version_id), String(initialLink.rows[0].asset_version_id));

  const newerVersion = await inspection.query(`insert into app.asset_versions(asset_id,workspace_id,version_no,created_by,metadata)
    select id,workspace_id,2,(select id from app.user_accounts where appwrite_user_id=$3),'{}'::jsonb
    from app.assets where id=$1 and workspace_id=$2 returning id`, [assetA.id, scopeA.workspaceId, userA]);
  await inspection.query(`insert into app.asset_files(asset_version_id,file_id,role,workspace_id)
    values($1,$2,'source',$3)`, [newerVersion.rows[0].id, initialLink.rows[0].file_id, scopeA.workspaceId]);
  const nextSave = await store.saveCanvasSnapshot(userA, snapshot(1, `image:${assetA.id}`));
  assert.equal(nextSave.versions[0].serverVersion, 2);
  const fixedLink = await inspection.query(`select asset_version_id from app.canvas_project_assets where project_id=$1 and asset_id=$2`, [project.rows[0].id, assetA.id]);
  assert.equal(String(fixedLink.rows[0].asset_version_id), String(initialLink.rows[0].asset_version_id), '已关联素材保留固定版本');
  const fixedNodeUse = await inspection.query(`select asset_version_id from app.canvas_node_asset_uses where project_id=$1 and asset_id=$2`, [project.rows[0].id, assetA.id]);
  assert.equal(String(fixedNodeUse.rows[0].asset_version_id), String(initialLink.rows[0].asset_version_id), '节点引用跟随项目固定素材版本');

  await assert.rejects(store.saveCanvasSnapshot(userA, snapshot(undefined, `image:${assetB.id}`, `cross-project-${suffix}`)), /不属于当前工作空间/);

  const taskInput = {
    taskType: 'image', provider: 'integration-test', model: 'integration-test', prompt: '关联测试', quantity: 1,
    idempotencyKey: `asset-input-${suffix}`, referenceAssetIds: [assetA.id],
  };
  const task = await store.createGenerationTask(userA, taskInput);
  let inputs = await inspection.query(`select distinct gi.file_id,av.asset_id,gi.position,gi.role from app.generation_inputs gi
    join app.asset_files af on af.file_id=gi.file_id and af.workspace_id=gi.workspace_id and af.role='source'
    join app.asset_versions av on av.id=af.asset_version_id and av.workspace_id=gi.workspace_id
    where gi.task_id=$1 and gi.role='reference' order by gi.position`, [task.id]);
  assert.equal(inputs.rowCount, 1, '生成任务应登记参考文件');
  assert.equal(String(inputs.rows[0].asset_id), assetA.id);
  assert.equal(inputs.rows[0].position, 0);
  assert.equal(inputs.rows[0].role, 'reference');
  await store.createGenerationTask(userA, taskInput);
  inputs = await inspection.query(`select id from app.generation_inputs where task_id=$1`, [task.id]);
  assert.equal(inputs.rowCount, 1, '幂等重试不得重复插入任务参考文件');
  await assert.rejects(store.createGenerationTask(userA, { ...taskInput, referenceAssetIds: [assetB.id] }), /不属于当前工作空间/);
  await assert.rejects(store.createGenerationTask(userA, { ...taskInput, referenceAssetIds: [] }), /不能更换参考素材/);

  console.log('通过：画布素材同空间关联、跨空间拒绝、项目素材版本固定、任务参考文件归属及幂等重试。');
} finally {
  await Promise.all([store.close(), inspection.end()]);
}
