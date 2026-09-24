import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeAssetUpload } from './asset-upload.mjs';
import http from 'node:http';

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'qingyu-upload-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'asset.bin');
}

test('正常分块上传：文件内容、大小和校验和一致', async t => {
  const target = await fixture(t);
  const expected = Buffer.from('图片内容验证');
  const result = await writeAssetUpload(Readable.from([expected.subarray(0, 3), expected.subarray(3)]), target, expected.length);
  assert.deepEqual(await readFile(target), expected);
  assert.deepEqual(result, { sizeBytes: expected.length, checksum: createHash('sha256').update(expected).digest('hex') });
});

test('超限上传：删除本次产生的半文件', async t => {
  const target = await fixture(t);
  await assert.rejects(writeAssetUpload(Readable.from([Buffer.alloc(4), Buffer.alloc(4)]), target, 5), /不能超过/);
  await assert.rejects(stat(target), { code: 'ENOENT' });
});

test('传输中断：删除已经写入的内容', async t => {
  const target = await fixture(t);
  const input = Readable.from((async function* () {
    yield Buffer.from('部分内容');
    throw new Error('模拟连接中断');
  })());
  await assert.rejects(writeAssetUpload(input, target), /模拟连接中断/);
  await assert.rejects(stat(target), { code: 'ENOENT' });
});

test('文件重名：拒绝覆盖且不能误删原文件', async t => {
  const target = await fixture(t);
  await writeFile(target, '原文件');
  await assert.rejects(writeAssetUpload(Readable.from([Buffer.from('新内容')]), target), { code: 'EEXIST' });
  assert.equal(await readFile(target, 'utf8'), '原文件');
});

test('真实 HTTP 超限：返回错误响应且没有残留文件', async t => {
  const target = await fixture(t);
  const server = http.createServer(async (req, res) => {
    try {
      await writeAssetUpload(req, target, 5);
      res.writeHead(201).end();
    } catch {
      res.writeHead(400).end('上传失败');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const status = await new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: server.address().port, method: 'POST' }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    request.on('error', reject);
    request.end(Buffer.alloc(10));
  });
  assert.equal(status, 400);
  await assert.rejects(stat(target), { code: 'ENOENT' });
});
