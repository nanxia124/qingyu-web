import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPostgresBillingStore } from './postgres-billing-store.mjs';

assert.equal(process.env.PGDATABASE, 'qingyu_canvas_verify', '测试只允许连接隔离数据库 qingyu_canvas_verify');

const store = await createPostgresBillingStore();
const userId = `canvas-version-${crypto.randomUUID()}`;
const projectId = `canvas-project-${crypto.randomUUID()}`;
const secondProjectId = `canvas-project-${crypto.randomUUID()}`;

function snapshot(serverVersion, title, id = projectId) {
  return {
    projects: [{
      id,
      ...(serverVersion ? { serverVersion } : {}),
      title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [],
      connections: [],
      chatSessions: [],
      activeChatId: null,
      backgroundMode: 'lines',
      showImageInfo: false,
      viewport: { x: 0, y: 0, k: 1 },
    }],
    deletedProjects: [],
  };
}

try {
  await store.ensureUser(userId, `${userId}@example.invalid`);

  const firstSave = await store.saveCanvasSnapshot(userId, snapshot(undefined, '初始版本'));
  assert.deepEqual(firstSave.versions, [{ id: projectId, serverVersion: 1 }]);

  const acceptedSave = await store.saveCanvasSnapshot(userId, snapshot(1, '设备 A 的新版本'));
  assert.deepEqual(acceptedSave.versions, [{ id: projectId, serverVersion: 2 }]);

  await assert.rejects(
    store.saveCanvasSnapshot(userId, snapshot(1, '设备 B 的过期版本')),
    (error) => error.code === 'VERSION_CONFLICT' && error.conflicts?.[0]?.serverVersion === 2,
  );
  let remote = await store.listCanvasSnapshots(userId);
  assert.equal(remote.projects[0].title, '设备 A 的新版本', '旧版本拒绝后，云端仍保留已接受的内容');
  assert.equal(remote.projects[0].serverVersion, 2);

  const concurrent = await Promise.allSettled([
    store.saveCanvasSnapshot(userId, snapshot(2, '并发设备 A')),
    store.saveCanvasSnapshot(userId, snapshot(2, '并发设备 B')),
  ]);
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1, '同一版本的并发保存只能成功一次');
  assert.equal(concurrent.filter((result) => result.status === 'rejected' && result.reason.code === 'VERSION_CONFLICT').length, 1);
  remote = await store.listCanvasSnapshots(userId);
  assert.equal(remote.projects[0].serverVersion, 3, '并发保存只增加一次版本');
  assert.ok(['并发设备 A', '并发设备 B'].includes(remote.projects[0].title));

  await store.saveCanvasSnapshot(userId, snapshot(undefined, '第二张画布', secondProjectId));
  await store.saveCanvasSnapshot(userId, snapshot(1, '第二张画布更新', secondProjectId));
  const currentWinner = remote.projects[0].title;
  await assert.rejects(
    store.saveCanvasSnapshot(userId, {
      projects: [snapshot(3, '本批次应整体回滚'), snapshot(1, '第二张画布过期版本', secondProjectId).projects[0]],
      deletedProjects: [],
    }),
    (error) => error.code === 'VERSION_CONFLICT',
  );
  remote = await store.listCanvasSnapshots(userId);
  const firstProject = remote.projects.find((project) => project.id === projectId);
  const secondProject = remote.projects.find((project) => project.id === secondProjectId);
  assert.equal(firstProject.title, currentWinner, '同一批次后续冲突时，前面已写的画布也必须回滚');
  assert.equal(firstProject.serverVersion, 3);
  assert.equal(secondProject.serverVersion, 2);
  assert.equal(secondProject.title, '第二张画布更新');

  console.log('通过：旧版本拒绝、并发保存互斥、多画布批次冲突整体回滚。');
} finally {
  await store.close();
}
