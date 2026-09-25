import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { createObjectStore } from './object-store.mjs';

const credentials = {
  NODE_ENV: 'test',
  COS_REGION: 'ap-singapore',
  COS_BUCKET_TEST: 'qingyu-test-assets-1259637119',
  COS_BUCKET_PROD: 'qingyu-prod-assets-1259637119',
  COS_SECRET_ID: 'test-secret-id',
  COS_SECRET_KEY: 'test-secret-key',
};

function mockCos(urlProvider = () => 'https://example.invalid/object') {
  const calls = { put: [], delete: [], sign: [], multipartInit: [], multipartPart: [], multipartComplete: [], multipartAbort: [] };
  const client = {
    putObject(params, callback) {
      calls.put.push(params);
      (async () => {
        const chunks = [];
        for await (const chunk of params.Body) chunks.push(chunk);
        callback(null, { VersionId: 'cos-version-7', ETag: 'etag-7', content: Buffer.concat(chunks) });
      })().catch(callback);
    },
    getObjectUrl(params, callback) {
      calls.sign.push(params);
      callback(null, { Url: urlProvider(params) });
    },
    deleteObject(params, callback) {
      calls.delete.push(params);
      callback(null, {});
    },
    multipartInit(params, callback) {
      calls.multipartInit.push(params);
      callback(null, { UploadId: 'upload-123' });
    },
    multipartUpload(params, callback) {
      calls.multipartPart.push(params);
      (async () => {
        const chunks = [];
        for await (const chunk of params.Body) chunks.push(chunk);
        callback(null, { ETag: `etag-${params.PartNumber}`, body: Buffer.concat(chunks) });
      })().catch(callback);
    },
    multipartComplete(params, callback) {
      calls.multipartComplete.push(params);
      callback(null, { ETag: 'complete-etag', VersionId: 'complete-version' });
    },
    multipartAbort(params, callback) {
      calls.multipartAbort.push(params);
      callback(null, {});
    },
  };
  return { calls, client };
}

test('COS 上传流：按测试环境存储桶写入并返回校验值和版本号', async () => {
  const { calls, client } = mockCos();
  const store = createObjectStore({ env: credentials, client });
  const body = Buffer.from('COS 内容');
  const result = await store.putObject({ key: 'workspaces/w/generated/images/one.png', buffer: body, contentType: 'image/png' });
  assert.equal(result.storageProvider, 'cos');
  assert.equal(result.bucket, credentials.COS_BUCKET_TEST);
  assert.equal(result.storageVersionId, 'cos-version-7');
  assert.equal(result.sizeBytes, body.length);
  assert.equal(result.sha256, createHash('sha256').update(body).digest('hex'));
  assert.equal(calls.put[0].Region, 'ap-singapore');
  assert.equal(calls.put[0].ContentLength, body.length);
  assert.equal(calls.put[0].Bucket, credentials.COS_BUCKET_TEST);
});

test('COS 配置按环境选择独立存储桶', async () => {
  const { calls, client } = mockCos();
  const store = createObjectStore({ env: { ...credentials, NODE_ENV: 'production' }, client });
  await store.putObject({ key: 'production.bin', buffer: Buffer.from('prod'), contentType: 'application/octet-stream' });
  assert.equal(calls.put[0].Bucket, credentials.COS_BUCKET_PROD);
});

test('私有 COS 文件仅在配置 CDN 鉴权后生成短时 TypeA 鉴权地址', () => {
  const now = Math.floor(Date.now() / 1000);
  const store = createObjectStore({ env: { ...credentials, COS_CDN_DOMAIN: 'media.example.com', COS_CDN_AUTH_KEY: 'testkey123456', COS_CDN_AUTH_TTL_SEC: '900' } });
  const url = new URL(store.signCdnReadUrl('workspaces/w/generated/images/a.png'));
  assert.equal(url.hostname, 'media.example.com');
  assert.equal(url.pathname, '/workspaces/w/generated/images/a.png');
  const [timestamp, nonce, uid, signature] = url.searchParams.get('sign').split('-');
  assert.ok(Number(timestamp) >= now && Number(timestamp) <= now + 1);
  assert.equal(uid, '0');
  assert.match(nonce, /^[a-f0-9]{24}$/);
  assert.equal(signature, createHash('md5').update(`${url.pathname}-${timestamp}-${nonce}-0-testkey123456`).digest('hex'));
  assert.equal(createObjectStore({ env: credentials }).signCdnReadUrl('workspaces/w/file.png'), null);
});

test('CDN TypeA 链接的有效期由域名配置约束，不会被单次请求延长', () => {
  const now = Math.floor(Date.now() / 1000);
  const store = createObjectStore({ env: { ...credentials, COS_CDN_DOMAIN: 'media.example.com', COS_CDN_AUTH_KEY: 'testkey123456', COS_CDN_AUTH_TTL_SEC: '900' } });
  const url = new URL(store.signCdnReadUrl('workspaces/w/file.png', 86400));
  const [timestamp] = url.searchParams.get('sign').split('-');
  assert.ok(Number(timestamp) >= now && Number(timestamp) <= now + 1);
});

test('较短 CDN TypeA 链接会提前签发，剩余有效期不超过请求时长', () => {
  const now = Math.floor(Date.now() / 1000);
  const store = createObjectStore({ env: { ...credentials, COS_CDN_DOMAIN: 'media.example.com', COS_CDN_AUTH_KEY: 'testkey123456', COS_CDN_AUTH_TTL_SEC: '3600' } });
  const url = new URL(store.signCdnReadUrl('workspaces/w/file.png', 300));
  const [timestamp] = url.searchParams.get('sign').split('-');
  assert.equal(Number(timestamp), now - 3300);
  assert.equal(Number(timestamp) + 3600 - now, 300);
});

test('缺少 COS 凭据或存储桶时明确失败，不回退本地磁盘', async () => {
  const store = createObjectStore({ env: { NODE_ENV: 'test' }, client: mockCos().client });
  await assert.rejects(store.putObject({ key: 'missing.bin', buffer: Buffer.from('x') }), /COS 存储未配置/);
});

test('拒绝非法对象键，且不发起 COS 请求', async () => {
  const { calls, client } = mockCos();
  const store = createObjectStore({ env: credentials, client });
  await assert.rejects(store.putObject({ key: '../escape.bin', buffer: Buffer.from('x') }), /非法 COS 对象键/);
  assert.equal(calls.put.length, 0);
});

test('COS 分片上传：初始化、校验并完成连续分片，且可中止会话', async () => {
  const { calls, client } = mockCos();
  const store = createObjectStore({ env: credentials, client });
  const initialized = await store.multipartInit({ key: 'workspaces/w/uploads/videos/a.mp4', contentType: 'video/mp4' });
  assert.equal(initialized.uploadId, 'upload-123');
  assert.equal(calls.multipartInit[0].ContentType, 'video/mp4');

  const part1 = await store.multipartUploadPart({
    key: 'workspaces/w/uploads/videos/a.mp4', uploadId: initialized.uploadId, partNumber: 1,
    body: Readable.from([Buffer.from('part-one')]), contentLength: 8,
  });
  assert.equal(part1.etag, 'etag-1');
  assert.equal(part1.sizeBytes, 8);
  const completed = await store.multipartComplete({
    key: 'workspaces/w/uploads/videos/a.mp4', uploadId: initialized.uploadId,
    parts: [{ partNumber: 1, etag: part1.etag, sizeBytes: part1.sizeBytes }],
  });
  assert.equal(completed.storageProvider, 'cos');
  assert.equal(completed.storageVersionId, 'complete-version');
  assert.deepEqual(calls.multipartComplete[0].Parts, [{ PartNumber: 1, ETag: 'etag-1' }]);
  await store.multipartAbort({ key: 'workspaces/w/uploads/videos/a.mp4', uploadId: initialized.uploadId });
  assert.equal(calls.multipartAbort.length, 1);
});

test('COS 分片上传：拒绝不连续清单和超限分片', async () => {
  const { client } = mockCos();
  const store = createObjectStore({ env: credentials, client });
  await assert.rejects(store.multipartComplete({ key: 'object.bin', uploadId: 'u', parts: [{ partNumber: 2, etag: 'e', sizeBytes: 10 }] }), /不连续/);
  await assert.rejects(store.multipartUploadPart({ key: 'object.bin', uploadId: 'u', partNumber: 1, body: Readable.from(['x']), contentLength: 17 * 1024 * 1024 }), /分片大小无效/);
});

test('上传大小与声明不符时失败并尝试删除不完整对象', async () => {
  const { calls, client } = mockCos();
  const store = createObjectStore({ env: credentials, client });
  await assert.rejects(store.putObject({ key: 'incomplete.bin', buffer: Buffer.from('longer'), contentLength: 2 }), /声明大小/);
  assert.equal(calls.delete[0].Bucket, credentials.COS_BUCKET_TEST);
});

test('私有读取使用短效签名并可按 Range 转发内容', async t => {
  const expected = Buffer.from('streamed-object-data');
  const server = http.createServer((request, response) => {
    assert.equal(request.headers.range, 'bytes=0-6');
    response.writeHead(206, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': '7',
      'Content-Range': `bytes 0-6/${expected.length}`,
    });
    response.end(expected.subarray(0, 7));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}/object`;
  const { calls, client } = mockCos(() => baseUrl);
  const store = createObjectStore({ env: credentials, client });
  const object = await store.getObjectStream('private/object.bin', { range: 'bytes=0-6' });
  const chunks = [];
  for await (const chunk of object.stream) chunks.push(chunk);
  assert.equal(object.statusCode, 206);
  assert.equal(object.contentLength, 7);
  assert.equal(object.contentRange, `bytes 0-6/${expected.length}`);
  assert.deepEqual(Buffer.concat(chunks), expected.subarray(0, 7));
  assert.equal(calls.sign[0].Sign, true);
  assert.equal(calls.sign[0].Expires, 60);
});
