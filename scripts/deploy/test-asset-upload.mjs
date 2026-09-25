import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import http from 'node:http';
import { buildAssetObjectKey, MAX_ASSET_UPLOAD_BYTES, writeAssetUpload } from './asset-upload.mjs';

test('COS 对象键按工作空间、来源、类型、年月和任务或上传批次分组', () => {
  const createdAt = new Date('2026-09-25T23:59:59.000Z');
  assert.equal(
    buildAssetObjectKey({ workspaceId: 'workspace-1', sourceKind: 'reference_upload', mediaType: 'image', createdAt, groupingId: 'batch-1', fileId: 'file-1', extension: '.png' }),
    'workspaces/workspace-1/references/images/2026/09/batch-1/file-1.png',
  );
  assert.equal(
    buildAssetObjectKey({ workspaceId: 'workspace-1', sourceKind: 'generated', mediaType: 'video', createdAt, groupingId: 'task-1', fileId: 'file-2', extension: '.mp4' }),
    'workspaces/workspace-1/generated/videos/2026/09/task-1/file-2.mp4',
  );
  assert.equal(
    buildAssetObjectKey({ workspaceId: 'workspace-1', sourceKind: 'edited', mediaType: 'image', createdAt, groupingId: 'edit-1', fileId: 'file-3', extension: '.png' }),
    'workspaces/workspace-1/edits/images/2026/09/edit-1/file-3.png',
  );
  assert.throws(() => buildAssetObjectKey({ workspaceId: 'workspace-1', sourceKind: 'unknown', mediaType: 'image', createdAt, groupingId: 'batch-1', fileId: 'file-1' }), /分类或分组信息无效/);
});

function requestStream(contentLength) {
  const stream = new PassThrough();
  stream.headers = { 'content-length': String(contentLength) };
  return stream;
}

function mockObjectStore() {
  return {
    async putObject({ key, body, contentLength, contentType, maxBytes }) {
      const chunks = [];
      let sizeBytes = 0;
      for await (const chunk of body) {
        sizeBytes += chunk.length;
        if (sizeBytes > maxBytes || sizeBytes > contentLength) throw new Error('上传内容超出限制');
        chunks.push(chunk);
      }
      if (sizeBytes !== contentLength) throw new Error('上传内容大小与声明不一致');
      return {
        storageProvider: 'cos', bucket: 'test-1259637119', objectKey: key,
        storageVersionId: 'version-1', sizeBytes, sha256: 'verified-by-cos-adapter', contentType,
        content: Buffer.concat(chunks),
      };
    },
  };
}

test('正常上传：请求流直接交给 COS，返回对象信息', async () => {
  const expected = Buffer.from('素材内容验证');
  const stream = requestStream(expected.length);
  const pending = writeAssetUpload(stream, mockObjectStore(), 'workspaces/w/uploads/images/a.bin', 'image/png');
  stream.end(expected);
  const result = await pending;
  assert.equal(result.storageProvider, 'cos');
  assert.equal(result.bucket, 'test-1259637119');
  assert.equal(result.sizeBytes, expected.length);
  assert.equal(result.checksum, 'verified-by-cos-adapter');
  assert.deepEqual(result.content, expected);
});

test('超过默认5GB限制：上传开始前拒绝，不调用 COS', async () => {
  const stream = requestStream(MAX_ASSET_UPLOAD_BYTES + 1);
  let called = false;
  const store = { putObject: async () => { called = true; } };
  await assert.rejects(writeAssetUpload(stream, store, 'too-large.bin', 'application/octet-stream'), /不能超过5120MB/);
  assert.equal(called, false);
});

test('缺少文件大小：拒绝无法安全流式传输的请求', async () => {
  const stream = requestStream('NaN');
  let called = false;
  await assert.rejects(
    writeAssetUpload(stream, { putObject: async () => { called = true; } }, 'unknown.bin', 'application/octet-stream'),
    /必须包含有效的文件大小/,
  );
  assert.equal(called, false);
});

test('HTTP 上传超限：返回错误响应且不创建本地文件', async t => {
  const server = http.createServer(async (req, res) => {
    try {
      await writeAssetUpload(req, mockObjectStore(), 'too-large.bin', 'application/octet-stream', 5);
      res.writeHead(201).end();
    } catch {
      res.writeHead(400).end('上传失败');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const status = await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1', port: server.address().port, method: 'POST',
      headers: { 'content-length': '10', 'content-type': 'application/octet-stream' },
    }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end(Buffer.alloc(10));
  });
  assert.equal(status, 400);
});
