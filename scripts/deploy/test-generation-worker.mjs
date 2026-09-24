import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

// 隔离执行真实 worker 函数，替换付费供应商和数据库依赖，不启动 HTTP 服务。
const source = await readFile(new URL('./api-server.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function runGenerationTaskWorker(');
const end = source.indexOf('// ===================== 计费路由处理器', start);
assert.ok(start >= 0 && end > start);
const workerSource = source.slice(start, end);
const urlStart = source.indexOf('function buildUpstreamImageUrl(');
const urlEnd = source.indexOf('async function callUpstreamImage(', urlStart);
const buildUpstreamImageUrl = vm.runInNewContext(`${source.slice(urlStart, urlEnd)}; buildUpstreamImageUrl`, { URL });

test('渠道地址已包含 /v1 时不会重复拼接', () => {
  assert.equal(buildUpstreamImageUrl('https://provider.example/v1').pathname, '/v1/images/generations');
  assert.equal(buildUpstreamImageUrl('https://provider.example').pathname, '/v1/images/generations');
});

test('重复 worker 只允许领取成功者调用上游', async () => {
  let claimed = false, calls = 0, settlements = 0, refunds = 0;
  const worker = vm.runInNewContext(`${workerSource}; runGenerationTaskWorker`, {
    console,
    postgresBilling: {
      async markTaskRunning() { if (claimed) return false; claimed = true; return true; },
      async settleTaskSuccess() { settlements++; },
      async failTask() { refunds++; },
    },
    async callUpstreamImage() { calls++; return { status: 200, text: JSON.stringify({ data: [{ url: 'https://example.invalid/test.png' }] }) }; },
    async fetchUrlAsBase64() { return 'dGVzdA=='; },
  });
  await Promise.all(Array.from({ length: 20 }, () => worker({ sub: 'test-user' }, { id: 'task' }, {}, {})));
  assert.equal(calls, 1);
  assert.equal(settlements, 1);
  assert.equal(refunds, 0);
});

test('领取失败不能调用供应商或释放其他 worker 的额度', async () => {
  let calls = 0, refunds = 0;
  const worker = vm.runInNewContext(`${workerSource}; runGenerationTaskWorker`, {
    console: { error() {} },
    postgresBilling: {
      async markTaskRunning() { throw new Error('模拟领取数据库故障'); },
      async failTask() { refunds++; },
    },
    async callUpstreamImage() { calls++; },
  });
  await worker({ sub: 'test-user' }, { id: 'task' }, {}, {});
  assert.equal(calls, 0);
  assert.equal(refunds, 0);
});
