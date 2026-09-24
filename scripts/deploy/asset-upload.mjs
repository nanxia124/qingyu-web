import { open, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// 逐块等待磁盘写入，失败时只清理本次创建的文件。
export async function writeAssetUpload(input, outputPath, maxBytes = 50 * 1024 * 1024) {
  const file = await open(outputPath, 'wx', 0o600);
  let closed = false;
  try {
    const hash = createHash('sha256');
    let sizeBytes = 0;
    for await (const chunk of input.iterator({ destroyOnReturn: false })) {
      sizeBytes += chunk.length;
      if (sizeBytes > maxBytes) throw new Error('单个文件不能超过50MB');
      await file.writeFile(chunk);
      hash.update(chunk);
    }
    await file.sync();
    await file.close();
    closed = true;
    return { sizeBytes, checksum: hash.digest('hex') };
  } catch (error) {
    if (!closed) await file.close().catch(() => {});
    // 继续消费 HTTP 请求剩余内容，让接口有机会返回错误响应。
    if (!input.destroyed) input.resume();
    try { await unlink(outputPath); }
    catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') throw new AggregateError([error, cleanupError], '上传失败且文件清理失败');
    }
    throw error;
  }
}
