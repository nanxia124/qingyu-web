import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { Readable } from 'node:stream';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('./api-server.mjs', import.meta.url), 'utf8');
const pollStart = source.indexOf('async function pollAsyncUpstreamTask(');
const workerEnd = source.indexOf('async function runGenerationTaskWorker(', pollStart);
const prefixStart = source.indexOf('async function peekStreamPrefix(');
const persistStart = source.indexOf('async function persistGeneratedImage(', prefixStart);
const mimeStart = source.indexOf('function sniffGeneratedMediaMime(');
const mimeEnd = source.indexOf('async function callUpstreamImageEditStreaming(', mimeStart);
const recoveryStart = source.indexOf('async function processGeneratedOutputRecoveryJob(');
const recoveryEnd = source.indexOf('async function processFileUploadRecoveryJob(', recoveryStart);
const recoveryDispatcherStart = source.indexOf('async function processFileUploadRecoveryJob(');
const serverStart = source.indexOf('const server = http.createServer(');
assert.ok(pollStart >= 0 && workerEnd > pollStart && prefixStart >= 0 && persistStart > prefixStart);
assert.ok(mimeStart >= 0 && mimeEnd > mimeStart && recoveryStart >= 0 && recoveryEnd > recoveryStart);
assert.ok(recoveryDispatcherStart >= 0 && serverStart > recoveryDispatcherStart);
const mediaWorkerSource = source.slice(pollStart, workerEnd);
const prefixSource = source.slice(prefixStart, persistStart);
const mimeSource = source.slice(mimeStart, mimeEnd);
const recoverySource = source.slice(recoveryStart, recoveryEnd);

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test('恢复 worker 在服务创建前处于模块作用域，启动定时器可以调用', () => {
  assert.ok(recoveryStart < serverStart);
  assert.ok(recoveryDispatcherStart < serverStart);
});

test('视频任务保存供应商任务号、流式入 COS，并在恢复后正常结算', async t => {
  const events = [];
  const media = Buffer.from('00000000ftypisom-video-bytes');
  const server = http.createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/v1/videos/generations') {
      for await (const _chunk of request) { /* consume body */ }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ id: 'provider-video-1' }));
      return;
    }
    if (request.method === 'GET' && request.url === '/v1/tasks/provider-video-1') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'completed', result_urls: [`http://127.0.0.1:${server.address().port}/video.mp4`] }));
      return;
    }
    if (request.url === '/video.mp4') {
      response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': media.length });
      response.write(media.subarray(0, 9));
      response.end(media.subarray(9));
      return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const storage = {
    getBucket() { return 'test-bucket'; },
    async getObjectStream() { throw new Error('没有引用图片'); },
    async putObject({ key, body, contentLength, contentType }) {
      events.push(['upload', key, await readStream(body), contentLength, contentType]);
      return { bucket: 'test-bucket', objectKey: key, sizeBytes: media.length, contentType };
    },
  };
  const billing = {
    async markTaskRunning() { events.push(['claim']); return true; },
    async beginGenerationAttempt() { events.push(['attempt']); return { attemptId: 'attempt-1' }; },
    async listGenerationInputFiles() { return []; },
    async setGenerationAttemptProviderTask(_user, _task, _attempt, providerTaskId) { events.push(['provider-task', providerTaskId]); },
    async reserveGeneratedOutput(_user, _task, _attempt, index, options) {
      events.push(['reserve', index, options.outputType, options.recoveryUrl]);
      return { outputId: 'output-1', fileId: 'file-1', objectKey: 'workspaces/w/generated/videos/video-1' };
    },
    async completeGenerationAttempt(_user, _task, _attempt, count, providerTaskId) { events.push(['complete', count, providerTaskId]); },
    async recordGeneratedOutput() { events.push(['record']); return { fileId: 'file-1' }; },
    async settleGenerationTaskIfComplete() { events.push(['settle']); },
    async failTask(_user, _task, code) { events.push(['refund', code]); },
  };
  const context = vm.createContext({ http, https: await import('node:https').then(m => m.default), Buffer, URL, Readable,
    setTimeout, console: { error() {} }, objectStore: storage, postgresBilling: billing, DEFAULT_MAX_UPLOAD_BYTES: 5 * 1024 ** 3,
    async fetchUrlAsStream(url) {
      const response = await fetch(url);
      return { body: Readable.fromWeb(response.body), contentLength: Number(response.headers.get('content-length')), contentType: response.headers.get('content-type') };
    },
    async peekStreamPrefix(source, size = 12) {
      const chunks = []; let length = 0; const iterator = source[Symbol.asyncIterator](); let pending; let ended = false;
      while (length < size) { const next = await iterator.next(); if (next.done) { ended = true; break; }
        const chunk = Buffer.from(next.value); const take = Math.min(size - length, chunk.length);
        chunks.push(chunk.subarray(0, take)); length += take; if (take < chunk.length) { pending = chunk.subarray(take); break; } }
      const prefix = Buffer.concat(chunks);
      return { prefix, body: Readable.from((async function* () { if (prefix.length) yield prefix; if (pending?.length) yield pending;
        if (!ended) for (;;) { const next = await iterator.next(); if (next.done) break; yield next.value; } })()) };
    },
    sniffGeneratedMediaMime(type, prefix, reported) {
      if (type === 'video' && String(reported).startsWith('video/')) return reported;
      if (type === 'video' && prefix.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
      throw new Error('媒体 MIME 无效');
    },
  });
  vm.runInContext(`${mediaWorkerSource}; ({ runGenerationTaskMediaWorker })`, context);
  const { runGenerationTaskMediaWorker } = vm.runInContext(`({ runGenerationTaskMediaWorker })`, context);
  await runGenerationTaskMediaWorker({ sub: 'user-1' }, { id: 'task-1', status: 'pending', taskType: 'video', model: 'video-model', prompt: 'test' },
    { base_url: `http://127.0.0.1:${server.address().port}/v1`, api_key: 'secret' }, { duration: 6, ratio: '16:9', resolution: '720p' });
  assert.deepEqual(events.filter(event => ['provider-task','reserve','complete','record','settle'].includes(event[0])).map(event => event[0]),
    ['provider-task','reserve','complete','record','settle']);
  assert.deepEqual(events.find(event => event[0] === 'upload').slice(2), [media, media.length, 'video/mp4']);
  assert.equal(events.some(event => event[0] === 'refund'), false);
});

test('音频供应商确认成功后即进入可恢复保存；COS 失败不会触发退款', async t => {
  const events = [];
  const media = Buffer.from('ID3audio-bytes');
  const server = http.createServer(async (request, response) => {
    if (request.url !== '/v1/audio/speech') { response.writeHead(404); response.end(); return; }
    for await (const _chunk of request) { /* consume body */ }
    response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': media.length });
    response.write(media.subarray(0, 3)); response.end(media.subarray(3));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const storage = {
    getBucket() { return 'test-bucket'; },
    async putObject({ body }) { await readStream(body); throw new Error('模拟 COS 暂时故障'); },
  };
  const billing = {
    async markTaskRunning() { return true; },
    async beginGenerationAttempt() { return { attemptId: 'attempt-audio' }; },
    async reserveGeneratedOutput(_user, _task, _attempt, _index, options) { events.push(['reserve', options.outputType]); return { outputId: 'output-a', fileId: 'file-a', objectKey: 'workspaces/w/audio.mp3' }; },
    async completeGenerationAttempt() { events.push(['provider-success']); },
    async recordGeneratedOutput() { throw new Error('不得登记'); },
    async settleGenerationTaskIfComplete() { events.push(['recovery-pending']); },
    async failTask() { events.push(['refund']); },
  };
  const context = vm.createContext({ http, https: await import('node:https').then(m => m.default), Buffer, URL, Readable, setTimeout,
    console: { error() {} }, objectStore: storage, postgresBilling: billing,
    async peekStreamPrefix(source, size = 12) {
      const chunks = []; let length = 0; const iterator = source[Symbol.asyncIterator](); let pending; let ended = false;
      while (length < size) { const next = await iterator.next(); if (next.done) { ended = true; break; }
        const chunk = Buffer.from(next.value); const take = Math.min(size - length, chunk.length); chunks.push(chunk.subarray(0, take)); length += take;
        if (take < chunk.length) { pending = chunk.subarray(take); break; } }
      const prefix = Buffer.concat(chunks);
      return { prefix, body: Readable.from((async function* () { if (prefix.length) yield prefix; if (pending?.length) yield pending;
        if (!ended) for (;;) { const next = await iterator.next(); if (next.done) break; yield next.value; } })()) };
    },
    sniffGeneratedMediaMime(type, prefix, reported) { if (type === 'audio' && String(reported).startsWith('audio/')) return reported; if (type === 'audio' && prefix.toString('ascii').startsWith('ID3')) return 'audio/mpeg'; throw new Error('媒体 MIME 无效'); },
  });
  vm.runInContext(`${mediaWorkerSource}; ({ runGenerationTaskMediaWorker })`, context);
  const { runGenerationTaskMediaWorker } = vm.runInContext(`({ runGenerationTaskMediaWorker })`, context);
  await runGenerationTaskMediaWorker({ sub: 'user-1' }, { id: 'audio-task', status: 'pending', taskType: 'audio', model: 'audio-model', prompt: 'hello' },
    { base_url: `http://127.0.0.1:${server.address().port}/v1`, api_key: 'secret' }, { format: 'mp3' });
  assert.deepEqual(events, [['reserve','audio'], ['provider-success'], ['recovery-pending']]);
});

test('MiniMax Speech 使用原生 T2A 请求格式并解码音频后流式保存', async t => {
  const events = [];
  const media = Buffer.from('ID3minimax-audio');
  let receivedBody;
  let receivedPath;
  const server = http.createServer(async (request, response) => {
    receivedPath = request.url;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: { audio: media.toString('hex'), status: 2 }, base_resp: { status_code: 0 } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const storage = {
    getBucket() { return 'test-bucket'; },
    async putObject({ key, body, contentLength, contentType }) {
      events.push(['upload', key, await readStream(body), contentLength, contentType]);
      return { bucket: 'test-bucket', objectKey: key, sizeBytes: media.length, contentType };
    },
  };
  const billing = {
    async markTaskRunning() { return true; },
    async beginGenerationAttempt() { return { attemptId: 'attempt-minimax' }; },
    async reserveGeneratedOutput(_user, _task, _attempt, _index, options) {
      events.push(['reserve', options.outputType]);
      return { outputId: 'output-minimax', fileId: 'file-minimax', objectKey: 'workspaces/w/audio.mp3' };
    },
    async completeGenerationAttempt() { events.push(['provider-success']); },
    async recordGeneratedOutput() { events.push(['record']); return { fileId: 'file-minimax' }; },
    async settleGenerationTaskIfComplete() { events.push(['settle']); },
    async failTask(_user, _task, code) { events.push(['refund', code]); },
  };
  const context = vm.createContext({ http, https: await import('node:https').then(m => m.default), Buffer, URL, Readable, setTimeout,
    console: { error() {} }, objectStore: storage, postgresBilling: billing,
    async peekStreamPrefix(source, size = 12) {
      const chunks = []; let length = 0; const iterator = source[Symbol.asyncIterator](); let pending; let ended = false;
      while (length < size) { const next = await iterator.next(); if (next.done) { ended = true; break; }
        const chunk = Buffer.from(next.value); const take = Math.min(size - length, chunk.length); chunks.push(chunk.subarray(0, take)); length += take;
        if (take < chunk.length) { pending = chunk.subarray(take); break; } }
      const prefix = Buffer.concat(chunks);
      return { prefix, body: Readable.from((async function* () { if (prefix.length) yield prefix; if (pending?.length) yield pending;
        if (!ended) for (;;) { const next = await iterator.next(); if (next.done) break; yield next.value; } })()) };
    },
    sniffGeneratedMediaMime(type, prefix, reported) {
      if (type === 'audio' && String(reported).startsWith('audio/')) return reported;
      if (type === 'audio' && prefix.toString('ascii').startsWith('ID3')) return 'audio/mpeg';
      throw new Error('媒体 MIME 无效');
    },
  });
  vm.runInContext(`${mediaWorkerSource}; ({ runGenerationTaskMediaWorker })`, context);
  const { runGenerationTaskMediaWorker } = vm.runInContext(`({ runGenerationTaskMediaWorker })`, context);
  await runGenerationTaskMediaWorker({ sub: 'user-1' }, { id: 'minimax-task', status: 'pending', taskType: 'audio', model: 'speech-2.8-hd', prompt: '你好' },
    { base_url: `http://127.0.0.1:${server.address().port}/v1`, api_key: 'secret' }, { voice: 'alloy', format: 'mp3', speed: 1.25 });
  assert.equal(receivedPath, '/v1/audio/speech');
  assert.deepEqual(receivedBody, {
    model: 'speech-2.8-hd', text: '你好', stream: false,
    voice_setting: { voice_id: 'male-qn-qingse', speed: 1.25, vol: 1, pitch: 0 },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 }, output_format: 'hex',
  });
  assert.deepEqual(events.map(event => event[0]), ['reserve','provider-success','upload','record','settle']);
  assert.deepEqual(events.find(event => event[0] === 'upload').slice(2), [media, media.length, 'audio/mpeg']);
});

test('服务器恢复作业能按视频类型从供应商地址重新下载并登记', async () => {
  const events = [];
  const video = Buffer.from('00000000ftypisom-video');
  const recoveryWorker = vm.runInNewContext(`${recoverySource}; processGeneratedOutputRecoveryJob`, {
    console: { log() {}, error() {} }, Buffer, Readable,
    sniffGeneratedMediaMime(type, _prefix, reported) { assert.equal(type, 'video'); return reported; },
    async fetchUrlAsStream(url) { events.push(['download', url]); return { body: Readable.from([video]), contentLength: video.length, contentType: 'video/mp4' }; },
    async peekStreamPrefix(source, size = 12) {
      const chunk = Buffer.from((await source[Symbol.asyncIterator]().next()).value);
      const prefix = chunk.subarray(0, size);
      return { prefix, body: Readable.from([chunk]) };
    },
    objectStore: { getBucket() { return 'test-bucket'; }, async headObject() { const error = new Error('missing'); error.code = 'NoSuchKey'; throw error; },
      async putObject({ key, body, contentLength, contentType }) { events.push(['upload', key, await readStream(body), contentLength, contentType]); return { sizeBytes: video.length, contentType }; } },
    postgresBilling: {
      async getGenerationOutputRecoveryContext() { return { task_status: 'saving', response_complete: true, availability: 'awaiting', output_type: 'video',
        recoveryUrl: 'https://provider.example/video', bucket: 'test-bucket', object_key: 'workspaces/w/video.mp4' }; },
      async finishGeneratedOutputRecoveryJob() { events.push(['finish']); return { taskId: 'task-v', outputId: 'output-v' }; },
      async settleGenerationTaskIfComplete() { events.push(['settle']); },
    },
  });
  await recoveryWorker({ id: 'job-v', appwriteUserId: 'user-v', generationOutputId: 'output-v' });
  assert.deepEqual(events.map(event => event[0]), ['download','upload','finish','settle']);
  assert.deepEqual(events[1].slice(2), [video, video.length, 'video/mp4']);
});

test('供应商明确判定视频任务失败后释放预占，不再无限轮询', async t => {
  const events = [];
  const server = http.createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/v1/videos/generations') {
      for await (const _chunk of request) { /* consume body */ }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ id: 'provider-video-failed' }));
      return;
    }
    if (request.method === 'GET' && request.url === '/v1/tasks/provider-video-failed') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'failed', error_msg: '供应商生成失败' }));
      return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const billing = {
    async markTaskRunning() { return true; },
    async beginGenerationAttempt() { return { attemptId: 'attempt-failed' }; },
    async listGenerationInputFiles() { return []; },
    async setGenerationAttemptProviderTask(_user, _task, _attempt, id) { events.push(['provider-task', id]); },
    async failTask(_user, _task, code, message, refund) { events.push(['failed', code, message, refund]); },
  };
  const context = vm.createContext({ http, https: await import('node:https').then(m => m.default), Buffer, URL, Readable,
    setTimeout() { throw new Error('明确失败后不能再安排轮询'); }, console: { error() {} }, objectStore: {}, postgresBilling: billing });
  vm.runInContext(`${mediaWorkerSource}; ({ runGenerationTaskMediaWorker })`, context);
  const { runGenerationTaskMediaWorker } = vm.runInContext(`({ runGenerationTaskMediaWorker })`, context);
  await runGenerationTaskMediaWorker({ sub: 'user-1' }, { id: 'task-failed', status: 'pending', taskType: 'video', model: 'video-model', prompt: 'test' },
    { base_url: `http://127.0.0.1:${server.address().port}/v1`, api_key: 'secret' }, { duration: 6 });
  assert.deepEqual(events, [['provider-task','provider-video-failed'], ['failed','upstream_task_failed','供应商生成失败',true]]);
});

test('供应商确认视频完成但未提供文件地址时结算为已生成但不可保存，不重试或退款', async t => {
  const events = [];
  const server = http.createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/v1/videos/generations') {
      for await (const _chunk of request) { /* consume body */ }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ id: 'provider-video-no-url' }));
      return;
    }
    if (request.method === 'GET' && request.url === '/v1/tasks/provider-video-no-url') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'completed' }));
      return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const billing = {
    async markTaskRunning() { return true; },
    async beginGenerationAttempt() { return { attemptId: 'attempt-no-url' }; },
    async listGenerationInputFiles() { return []; },
    async setGenerationAttemptProviderTask() {},
    async completeGenerationAttempt(_user, _task, _attempt, count, providerId) { events.push(['complete', count, providerId]); },
    async settleGenerationTaskIfComplete(_user, _task, providerId) { events.push(['settle', providerId]); },
    async failTask() { events.push(['refund']); },
  };
  const context = vm.createContext({ http, https: await import('node:https').then(m => m.default), Buffer, URL, Readable,
    setTimeout() { throw new Error('已确认完成后不能再次请求生成'); }, console: { error() {} }, objectStore: {}, postgresBilling: billing });
  vm.runInContext(`${mediaWorkerSource}; ({ runGenerationTaskMediaWorker })`, context);
  const { runGenerationTaskMediaWorker } = vm.runInContext(`({ runGenerationTaskMediaWorker })`, context);
  await runGenerationTaskMediaWorker({ sub: 'user-1' }, { id: 'task-no-url', status: 'pending', taskType: 'video', model: 'video-model', prompt: 'test' },
    { base_url: `http://127.0.0.1:${server.address().port}/v1`, api_key: 'secret' }, { duration: 6 });
  assert.deepEqual(events, [['complete',0,'provider-video-no-url'], ['settle','provider-video-no-url']]);
});
