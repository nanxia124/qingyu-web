import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { PassThrough, Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import vm from 'node:vm';
import test from 'node:test';
import { extForMime, sniffImageMime } from './object-store.mjs';

// 隔离执行真实 worker 函数，替换付费供应商和数据库依赖，不启动 HTTP 服务。
const source = await readFile(new URL('./api-server.mjs', import.meta.url), 'utf8');
const streamHelpersStart = source.indexOf('async function fetchUrlAsStream(');
const streamHelpersEnd = source.indexOf('// 把生成图直接写 COS', streamHelpersStart);
assert.ok(streamHelpersStart >= 0 && streamHelpersEnd > streamHelpersStart);
const streamHelpers = vm.runInNewContext(
  `${source.slice(streamHelpersStart, streamHelpersEnd)}; ({ fetchUrlAsStream, peekStreamPrefix })`,
  { http, https, Readable, Buffer, URL, DEFAULT_MAX_UPLOAD_BYTES: 5 * 1024 * 1024 * 1024 },
);
const imagePipelineStart = source.indexOf('function buildUpstreamImageUrl(');
const imagePipelineEnd = source.indexOf('async function persistGeneratedImage(', imagePipelineStart);
assert.ok(imagePipelineStart >= 0 && imagePipelineEnd > imagePipelineStart);
const imageObjectStore = { getBucket() { return 'test-bucket'; }, async getObjectStream() { throw new Error('测试未配置参考素材流'); } };
const imagePipeline = vm.runInNewContext(
  `${source.slice(imagePipelineStart, imagePipelineEnd)}; ({ buildUpstreamImageUrl, callUpstreamImage, parseImageGenerationResponse })`,
  { http, https, PassThrough, Readable, StringDecoder, Buffer, URL, crypto, extForMime, objectStore: imageObjectStore, DEFAULT_MAX_UPLOAD_BYTES: 5 * 1024 * 1024 * 1024 },
);
const persistStart = source.indexOf('async function persistGeneratedImage(');
const persistEnd = source.indexOf('// 部分上游', persistStart);
assert.ok(persistStart >= 0 && persistEnd > persistStart);
const persistGeneratedImageSource = source.slice(persistStart, persistEnd);
const start = source.indexOf('async function runGenerationTaskWorker(');
const end = source.indexOf('// ===================== 计费路由处理器', start);
assert.ok(start >= 0 && end > start);
const workerSource = source.slice(start, end);
const recoveryStart = source.indexOf('async function processGeneratedOutputRecoveryJob(');
const recoveryEnd = source.indexOf('async function processFileUploadRecoveryJob(', recoveryStart);
assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart);
const recoveryWorkerSource = source.slice(recoveryStart, recoveryEnd);
const mediaWorkerStart = source.indexOf('async function runGenerationTaskMediaWorker(');
const mediaWorkerEnd = source.indexOf('async function runGenerationTaskWorker(', mediaWorkerStart);
assert.ok(mediaWorkerStart >= 0 && mediaWorkerEnd > mediaWorkerStart);
const mediaWorkerSource = source.slice(mediaWorkerStart, mediaWorkerEnd);
const imageWorkerSource = source.slice(source.indexOf('async function runGenerationTaskWorker('), source.indexOf('// ===================== 计费路由处理器'));
const canvasImageService = await readFile(new URL('../../src/canvas/services/api/image.ts', import.meta.url), 'utf8');
const canvasPluginHost = await readFile(new URL('../../src/canvas/pages/canvas/hooks/use-plugin-host.tsx', import.meta.url), 'utf8');
async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test('渠道地址已包含 /v1 时不会重复拼接', () => {
  assert.equal(imagePipeline.buildUpstreamImageUrl('https://provider.example/v1').pathname, '/v1/images/generations');
  assert.equal(imagePipeline.buildUpstreamImageUrl('https://provider.example').pathname, '/v1/images/generations');
});

test('画布普通生图、改图和插件生图入口都复用报价与 generation task 服务', () => {
  const requestGeneration = canvasImageService.match(/export async function requestGeneration[\s\S]*?\n}\n/);
  const requestEdit = canvasImageService.match(/export async function requestEdit[\s\S]*?\n}\n/);
  const requestImageQuestion = canvasImageService.match(/export async function requestImageQuestion[\s\S]*?\n}\n/);
  assert.ok(requestGeneration && /runBilledImageTask\(/.test(requestGeneration[0]));
  assert.ok(requestEdit && /runBilledImageTask\(/.test(requestEdit[0]));
  assert.ok(requestImageQuestion && /billingApi\.quote\(/.test(requestImageQuestion[0]) && /\/api\/generation-tasks\/media/.test(requestImageQuestion[0]));
  assert.doesNotMatch(canvasImageService, /runModelPlugin\(|https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/.*generateContent|\/images\/(?:generations|edits)/);
  assert.match(canvasPluginHost, /generateImage:[\s\S]*?request(?:Edit|Generation)\(/);
  assert.match(canvasPluginHost, /generateText:[\s\S]*?requestImageQuestion\(/);
});

test('上游图片地址以响应流返回，不在下载阶段拼接整张图片', async t => {
  const expected = Buffer.from('0123456789abcdef-image');
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': expected.length });
    response.write(expected.subarray(0, 7));
    response.end(expected.subarray(7));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await streamHelpers.fetchUrlAsStream(`http://127.0.0.1:${server.address().port}/image`);
  assert.equal(result.contentLength, expected.length);
  assert.deepEqual(await readStream(result.body), expected);
});

test('供应商 Base64 JSON 回包边读边解码并上传，不保留完整 Base64 字段', async t => {
  const expected = Buffer.from(Array.from({ length: 256 * 1024 + 37 }, (_, index) => index % 251));
  const responseText = JSON.stringify({ id: 'provider-task-1', data: [{ revised_prompt: '一张图片', b64_json: expected.toString('base64') }] });
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    for (let offset = 0; offset < responseText.length; offset += 8191) response.write(responseText.slice(offset, offset + 8191));
    response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  let uploadedIndex = -1;
  let uploadedBytes;
  const result = await imagePipeline.callUpstreamImage(
    { base_url: `http://127.0.0.1:${server.address().port}/v1`, api_key: 'test' },
    { prompt: 'test' },
    async (index, file) => {
      uploadedIndex = index;
      uploadedBytes = await readStream(file.body);
      return { fileId: 'stored-file-1', index };
    },
  );
  assert.equal(result.status, 200);
  assert.equal(result.text, undefined);
  assert.equal(result.payload.id, 'provider-task-1');
  assert.equal(result.payload.data[0].__hasBase64, true);
  assert.equal(result.payload.data[0].b64_json, undefined);
  assert.equal(result.payload.data[0].__savedOutput.fileId, 'stored-file-1');
  assert.equal(uploadedIndex, 0);
  assert.deepEqual(uploadedBytes, expected);
});

test('参考图从 COS 流式转发到 images/edits，不先落服务器硬盘', async t => {
  const expected = Buffer.from('reference-image-bytes');
  let requestBody = Buffer.alloc(0);
  let requestPath = '';
  const server = http.createServer(async (request, response) => {
    requestPath = request.url;
    for await (const chunk of request) requestBody = Buffer.concat([requestBody, chunk]);
    assert.equal(Number(request.headers['content-length']), requestBody.length);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: [{ b64_json: Buffer.from('generated').toString('base64') }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  imageObjectStore.getObjectStream = async key => {
    assert.equal(key, 'workspaces/test/reference.png');
    return { stream: Readable.from([expected.subarray(0, 8), expected.subarray(8)]) };
  };
  const result = await imagePipeline.callUpstreamImage(
    { base_url: `http://127.0.0.1:${server.address().port}/v1`, api_key: 'test' },
    { model: 'test-image', prompt: '保留主体', n: 1, referenceAssetIds: ['asset-id'] },
    async () => ({ fileId: 'generated-file' }),
    [{ storageProvider: 'cos', bucket: 'test-bucket', mediaType: 'image', mimeType: 'image/png', sizeBytes: expected.length, objectKey: 'workspaces/test/reference.png' }],
  );
  assert.equal(requestPath, '/v1/images/edits');
  assert.match(requestBody.toString(), /name="prompt"/);
  assert.match(requestBody.toString(), /保留主体/);
  assert.match(requestBody.toString(), /name="image"/);
  assert.ok(requestBody.includes(expected));
  assert.equal(result.payload.data[0].__savedOutput.fileId, 'generated-file');
});

test('供应商返回损坏的 Base64 图片时拒绝保存', async () => {
  const body = Readable.from([Buffer.from('{"data":[{"b64_json":"not base64!"}]}')]);
  await assert.rejects(
    imagePipeline.parseImageGenerationResponse(body, async () => ({ fileId: 'unused' }), 1024 * 1024),
    /图片编码无效/,
  );
  const invalidPadding = Readable.from([Buffer.from('{"data":[{"b64_json":"Q==="}]}')]);
  await assert.rejects(
    imagePipeline.parseImageGenerationResponse(invalidPadding, async () => ({ fileId: 'unused' }), 1024 * 1024),
    /图片编码无效/,
  );
});

test('很短的 Base64 图片也能正确处理双等号结尾', async () => {
  const expected = Buffer.from([0x41]);
  const body = Readable.from([Buffer.from(JSON.stringify({ data: [{ b64_json: expected.toString('base64') }] }))]);
  let uploaded;
  const payload = await imagePipeline.parseImageGenerationResponse(body, async (_index, file) => {
    uploaded = await readStream(file.body);
    return { fileId: 'tiny-image' };
  }, 1024 * 1024);
  assert.deepEqual(uploaded, expected);
  assert.equal(payload.data[0].__savedOutput.fileId, 'tiny-image');
});

test('供应商错误 JSON 保留可读的具体错误信息', async t => {
  const server = http.createServer((_request, response) => {
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'API 密钥无效' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await imagePipeline.callUpstreamImage(
    { base_url: `http://127.0.0.1:${server.address().port}/v1`, api_key: 'test' },
    { prompt: 'test' },
  );
  assert.equal(result.status, 401);
  assert.equal(result.payload.error.message, 'API 密钥无效');
});

test('生成图片先留恢复位置；数据库登记失败时保留 COS 对象供恢复作业接手', async () => {
  const expected = Buffer.from('89504e470d0a1a0a0000000d49484452aabbccdd', 'hex');
  const uploaded = [];
  const deleted = [];
  const objectStore = {
    getBucket() { return 'test-bucket'; },
    async putObject({ key, body, contentLength, contentType }) {
      uploaded.push({ key, body: await readStream(body), contentLength, contentType });
      return { bucket: 'test-bucket', objectKey: key, sizeBytes: expected.length };
    },
    async deleteObject(key) { deleted.push(key); },
  };
  const postgresBilling = {
    async reserveGeneratedOutput() { return { fileId: 'file-1', outputId: 'output-1', objectKey: 'workspaces/w/generated/images/fixed-key' }; },
    async recordGeneratedOutput() { throw new Error('模拟数据库登记失败'); },
  };
  const persistGeneratedImage = vm.runInNewContext(
    `${persistGeneratedImageSource}; persistGeneratedImage`,
    {
      Buffer, Readable, crypto, postgresBilling, objectStore,
      peekStreamPrefix: streamHelpers.peekStreamPrefix, sniffImageMime,
      console: { error() {} },
    },
  );
  const body = Readable.from([expected.subarray(0, 5), expected.subarray(5)]);
  await assert.rejects(
    persistGeneratedImage({ sub: 'user-1' }, { id: 'task-1', workspaceId: 'workspace-1', createdAt: '2026-09-25T00:00:00Z' }, 'attempt-1', 0, { body }, null),
    /模拟数据库登记失败/,
  );
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].contentLength, undefined);
  assert.equal(uploaded[0].contentType, 'image/png');
  assert.equal(uploaded[0].key, 'workspaces/w/generated/images/fixed-key');
  assert.deepEqual(uploaded[0].body, expected);
  assert.deepEqual(deleted, []);
});

test('重复 worker 只允许领取成功者调用上游', async () => {
  let claimed = false, calls = 0, settlements = 0, refunds = 0;
  const storedContents = [];
  const worker = vm.runInNewContext(`${workerSource}; runGenerationTaskWorker`, {
    console,
    ...streamHelpers,
    postgresBilling: {
      async markTaskRunning() { if (claimed) return false; claimed = true; return true; },
      async listGenerationInputFiles() { return []; },
      async beginGenerationAttempt() { return { attemptId: 'attempt-1' }; },
      async completeGenerationAttempt() {},
      async settleGenerationTaskIfComplete() { settlements++; },
      async failTask() { refunds++; },
    },
    async callUpstreamImage(_channel, _body, onBase64Output) {
      calls++;
      const savedOutput = await onBase64Output(0, { body: Readable.from([Buffer.from('test-image-data')]) });
      return { status: 200, payload: { data: [{ __hasBase64: true, __savedOutput: savedOutput }] } };
    },
    async callUpstreamImageForTask(_channel, _body, callback) {
      calls++;
      const savedOutput = await callback(0, { body: Readable.from([Buffer.from('test-image-data')]) });
      return { status: 200, payload: { data: [{ __hasBase64: true, __savedOutput: savedOutput }] } };
    },
    async persistGeneratedImage(_identity, _task, _attempt, index, source) {
      storedContents.push(await readStream(source.body));
      return { type: 'image', index, fileId: `file-${index}`, objectKey: `test/${index}.png` };
    },
    objectStore: { getBucket() { return 'test-bucket'; } },
  });
  await Promise.all(Array.from({ length: 20 }, () => worker({ sub: 'test-user' }, { id: 'task' }, {}, {})));
  assert.equal(calls, 1);
  assert.equal(settlements, 1);
  assert.equal(refunds, 0);
  assert.deepEqual(storedContents, [Buffer.from('test-image-data')]);
});

test('URL 图片先持久化加密恢复来源，确认上游响应完整后才启动保存', async () => {
  const events = [];
  const worker = vm.runInNewContext(`${workerSource}; runGenerationTaskWorker`, {
    console: { error() {} },
    ...streamHelpers,
    objectStore: { getBucket() { return 'test-bucket'; } },
    postgresBilling: {
      async markTaskRunning() { return true; },
      async listGenerationInputFiles() { return []; },
      async beginGenerationAttempt() { return { attemptId: 'attempt-1' }; },
      async reserveGeneratedOutput(_user, _task, _attempt, index, options) {
        events.push(['reserve', index, options.recoveryUrl]);
        return { outputId: 'output-1', fileId: 'file-1', objectKey: 'workspaces/w/generated/fixed' };
      },
      async completeGenerationAttempt() { events.push(['response-complete']); },
      async settleGenerationTaskIfComplete() { events.push(['settle']); },
      async failTask() { events.push(['refund']); },
    },
    async callUpstreamImage() {
      return { status: 200, payload: { id: 'provider-1', data: [{ url: 'https://provider.example/signed-image?sig=secret' }] } };
    },
    async callUpstreamImageForTask() { return { status: 200, payload: { id: 'provider-1', data: [{ url: 'https://provider.example/signed-image?sig=secret' }] } }; },
    async persistGeneratedImageUrl(_identity, _task, _attempt, index, _url, _prompt, slot) {
      events.push(['upload', index, slot.outputId]);
      return { type: 'image', index, fileId: slot.fileId, objectKey: slot.objectKey };
    },
  });
  await worker({ sub: 'test-user' }, { id: 'task-1' }, {}, {});
  assert.deepEqual(events, [
    ['reserve', 0, 'https://provider.example/signed-image?sig=secret'],
    ['response-complete'],
    ['upload', 0, 'output-1'],
    ['settle'],
  ]);
});

test('服务器重启后可从加密来源重新下载图片并完成入库', async () => {
  const events = [];
  const expected = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const recoveryWorker = vm.runInNewContext(`${recoveryWorkerSource}; processGeneratedOutputRecoveryJob`, {
    console: { log() {}, error() {} },
    Buffer, Readable, sniffImageMime,
    sniffGeneratedMediaMime(type, prefix) { if (type === 'image') return sniffImageMime(prefix); throw new Error('测试未配置媒体类型检测'); },
    async fetchUrlAsStream(url) {
      events.push(['fetch', url]);
      return { body: Readable.from([expected]), contentLength: expected.length };
    },
    peekStreamPrefix: streamHelpers.peekStreamPrefix,
    objectStore: {
      getBucket() { return 'test-bucket'; },
      async headObject() { const error = new Error('missing'); error.code = 'NoSuchKey'; throw error; },
      async putObject({ key, body, contentLength, contentType }) {
        events.push(['upload', key, await readStream(body), contentLength, contentType]);
        return { storageVersionId: 'recovered-version', sizeBytes: expected.length, contentType };
      },
    },
    postgresBilling: {
      async getGenerationOutputRecoveryContext() {
        return { task_status: 'saving', response_complete: true, availability: 'awaiting', recoveryUrl: 'https://provider.example/image?signature=private',
          bucket: 'test-bucket', object_key: 'workspaces/w/generated/image-1' };
      },
      async finishGeneratedOutputRecoveryJob() { events.push(['finish']); return { taskId: 'task-1', outputId: 'output-1' }; },
      async settleGenerationTaskIfComplete() { events.push(['settle']); },
    },
  });
  await recoveryWorker({ id: 'job-1', appwriteUserId: 'user-1', generationOutputId: 'output-1' });
  assert.deepEqual(events, [
    ['fetch', 'https://provider.example/image?signature=private'],
    ['upload', 'workspaces/w/generated/image-1', expected, expected.length, 'image/png'],
    ['finish'], ['settle'],
  ]);
});

test('领取失败不能调用供应商或释放其他 worker 的额度', async () => {
  let calls = 0, refunds = 0;
  const worker = vm.runInNewContext(`${workerSource}; runGenerationTaskWorker`, {
    console: { error() {} },
    postgresBilling: {
      async markTaskRunning() { throw new Error('模拟领取数据库故障'); },
      async listGenerationInputFiles() { return []; },
      async beginGenerationAttempt() { throw new Error('不应启动'); },
      async failTask() { refunds++; },
    },
    async callUpstreamImage() { calls++; },
    async callUpstreamImageForTask() { calls++; },
  });
  await worker({ sub: 'test-user' }, { id: 'task' }, {}, {});
  assert.equal(calls, 0);
  assert.equal(refunds, 0);
});

test('文本问答任务由服务端调用渠道、成功结算并把答案写入任务输出', async () => {
  const events = [];
  const worker = vm.runInNewContext(`${mediaWorkerSource}; runGenerationTaskMediaWorker`, {
    console: { error() {} },
    async callUpstreamText(_channel, task) { events.push(['provider', task.parameters.body.model]); return '回答内容'; },
    postgresBilling: {
      async markTaskRunning() { events.push('claim'); return true; },
      async beginGenerationAttempt() { events.push('attempt'); return { attemptId: 'attempt-text' }; },
      async completeGenerationAttempt(_user, _task, _attempt, count) { events.push(['complete', count]); },
      async settleTextTask(_user, _task, answer) { events.push(['settle-text', answer]); },
      async failTask(...args) { events.push(['refund', ...args]); },
    },
  });
  await worker({ sub: 'test-user' }, { id: 'text-task', taskType: 'text', status: 'pending', parameters: { body: { model: 'catalog-model' } } }, { provider: 'openai' }, { body: { model: 'catalog-model' } });
  assert.deepEqual(events, ['claim', 'attempt', ['provider', 'catalog-model'], ['complete', 1], ['settle-text', '回答内容']]);
});

test('文本问答供应商失败时退款，不执行成功结算', async () => {
  const events = [];
  const worker = vm.runInNewContext(`${mediaWorkerSource}; runGenerationTaskMediaWorker`, {
    console: { error() {} },
    postgresBilling: {
      async markTaskRunning() { return true; },
      async beginGenerationAttempt() { return { attemptId: 'attempt-text' }; },
      async failTask(_user, _task, code, message, refund) { events.push([code, message, refund]); },
    },
    async callUpstreamText() { throw new Error('供应商拒绝请求'); },
  });
  await worker({ sub: 'test-user' }, { id: 'text-task', taskType: 'text', status: 'pending', parameters: {} }, { provider: 'openai' }, {});
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'upstream_error');
  assert.match(events[0][1], /供应商拒绝请求/);
  assert.equal(events[0][2], true);
});

test('图片与改图任务仍经过计费图片 worker，输出失败会退款', async () => {
  const events = [];
  const worker = vm.runInNewContext(`${workerSource}; runGenerationTaskWorker`, {
    console: { error() {} }, ...streamHelpers,
    postgresBilling: {
      async markTaskRunning() { return true; },
      async beginGenerationAttempt() { return { attemptId: 'attempt-image' }; },
      async listGenerationInputFiles() { return [{ mediaType: 'image' }]; },
      async failTask(_user, _task, code, message, refund) { events.push([code, message, refund]); },
    },
    async callUpstreamImageForTask() { return { status: 503, text: '上游失败', payload: {} }; },
  });
  await worker({ sub: 'test-user' }, { id: 'edit-task' }, {}, { __qingyuCatalogModelId: 1 });
  assert.equal(events.length, 1);
  assert.equal(events[0][2], true);
});
