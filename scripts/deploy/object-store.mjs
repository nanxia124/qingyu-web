import COS from 'cos-nodejs-sdk-v5';
import { Readable, Transform } from 'node:stream';
import { createHash, randomBytes } from 'node:crypto';

const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

function invoke(client, method, params) {
  return new Promise((resolve, reject) => {
    client[method](params, (error, result) => error ? reject(error) : resolve(result));
  });
}

export function createObjectStore({ env = process.env, client: injectedClient } = {}) {
  let client = injectedClient || null;

  function settings() {
    const production = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
    const bucket = String(production ? env.COS_BUCKET_PROD || '' : env.COS_BUCKET_TEST || '').trim();
    const region = String(env.COS_REGION || '').trim();
    const secretId = String(env.COS_SECRET_ID || '').trim();
    const secretKey = String(env.COS_SECRET_KEY || '').trim();
    const missing = [
      !bucket && (production ? 'COS_BUCKET_PROD' : 'COS_BUCKET_TEST'),
      !region && 'COS_REGION',
      !secretId && 'COS_SECRET_ID',
      !secretKey && 'COS_SECRET_KEY',
    ].filter(Boolean);
    if (missing.length) throw new Error(`COS 存储未配置：缺少 ${missing.join('、')}`);
    return { bucket, region, secretId, secretKey };
  }

  function getClient(config) {
    if (!client) {
      client = new COS({
        SecretId: config.secretId,
        SecretKey: config.secretKey,
        Protocol: 'https:',
        Timeout: 120000,
      });
    }
    return client;
  }

  async function putObject({ key, body, buffer, contentType, contentLength, maxBytes = DEFAULT_MAX_UPLOAD_BYTES }) {
    if (!key || key.startsWith('/') || key.split('/').some(part => part === '..')) {
      throw new Error('非法 COS 对象键');
    }
    const config = settings();
    const source = buffer ? Readable.from([buffer]) : body;
    if (!source || typeof source.pipe !== 'function') throw new Error('缺少上传内容流');
    const declaredLength = contentLength ?? buffer?.length;
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      throw new Error('COS 流式上传必须提供有效文件大小');
    }
    if (declaredLength > maxBytes) throw new Error('文件超过允许的大小限制');

    const hash = createHash('sha256');
    let sizeBytes = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        sizeBytes += chunk.length;
        if (sizeBytes > maxBytes || sizeBytes > declaredLength) {
          callback(new Error('上传内容超过声明大小或允许的大小限制'));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
      flush(callback) {
        if (sizeBytes !== declaredLength) callback(new Error('上传内容大小与声明不一致'));
        else callback();
      },
    });
    source.pipe(meter);

    const params = {
      Bucket: config.bucket,
      Region: config.region,
      Key: key,
      Body: meter,
      ContentLength: declaredLength,
      ContentType: contentType || 'application/octet-stream',
    };
    const cosClient = getClient(config);
    try {
      const result = await invoke(cosClient, 'putObject', params);
      return {
        storageProvider: 'cos',
        bucket: config.bucket,
        objectKey: key,
        storageVersionId: result?.VersionId || null,
        etag: result?.ETag || null,
        sizeBytes,
        sha256: hash.digest('hex'),
        contentType: contentType || 'application/octet-stream',
      };
    } catch (error) {
      source.unpipe?.(meter);
      if (!source.destroyed) source.resume?.();
      meter.destroy();
      // 每次写入都使用新文件编号；超时等结果不明时清理本次唯一对象键。
      await invoke(cosClient, 'deleteObject', {
        Bucket: config.bucket,
        Region: config.region,
        Key: key,
      }).catch(() => {});
      throw error;
    }
  }

  async function multipartInit({ key, contentType }) {
    if (!key || key.startsWith('/') || key.split('/').some(part => part === '..')) throw new Error('非法 COS 对象键');
    const config = settings();
    const result = await invoke(getClient(config), 'multipartInit', {
      Bucket: config.bucket, Region: config.region, Key: key, ContentType: contentType || 'application/octet-stream',
    });
    if (!result?.UploadId) throw new Error('COS 没有返回分片上传编号');
    return { bucket: config.bucket, uploadId: result.UploadId };
  }

  async function multipartUploadPart({ key, uploadId, partNumber, body, contentLength, maxBytes = 16 * 1024 * 1024 }) {
    if (!key || key.startsWith('/') || key.split('/').some(part => part === '..')) throw new Error('非法 COS 对象键');
    if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) throw new Error('分片上传参数无效');
    if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > maxBytes) throw new Error('单个上传分片大小无效');
    const config = settings();
    const hash = createHash('sha256');
    let sizeBytes = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        sizeBytes += chunk.length;
        if (sizeBytes > maxBytes || sizeBytes > contentLength) return callback(new Error('分片内容超过声明大小'));
        hash.update(chunk);
        callback(null, chunk);
      },
      flush(callback) { callback(sizeBytes === contentLength ? undefined : new Error('分片内容大小与声明不一致')); },
    });
    body.pipe(meter);
    try {
      const result = await invoke(getClient(config), 'multipartUpload', {
        Bucket: config.bucket, Region: config.region, Key: key, UploadId: uploadId,
        PartNumber: partNumber, Body: meter, ContentLength: contentLength,
      });
      return { etag: result?.ETag, sizeBytes, checksum: hash.digest('hex') };
    } catch (error) {
      body.unpipe?.(meter);
      if (!body.destroyed) body.resume?.();
      meter.destroy();
      throw error;
    }
  }

  async function multipartComplete({ key, uploadId, parts }) {
    if (!key || key.startsWith('/') || key.split('/').some(part => part === '..')) throw new Error('非法 COS 对象键');
    if (!uploadId || !Array.isArray(parts) || !parts.length || parts.length > 10000) throw new Error('分片清单无效');
    const normalized = parts.map((part, index) => {
      if (part.partNumber !== index + 1 || !part.etag || !Number.isSafeInteger(part.sizeBytes) || part.sizeBytes < 1) throw new Error('分片清单不连续或内容无效');
      return { PartNumber: part.partNumber, ETag: part.etag };
    });
    const config = settings();
    const result = await invoke(getClient(config), 'multipartComplete', {
      Bucket: config.bucket, Region: config.region, Key: key, UploadId: uploadId, Parts: normalized,
    });
    return { bucket: config.bucket, storageProvider: 'cos', storageVersionId: result?.VersionId || null, etag: result?.ETag || null };
  }

  async function multipartListParts({ key, uploadId }) {
    if (!key || key.startsWith('/') || key.split('/').some(part => part === '..')) throw new Error('非法 COS 对象键');
    if (!uploadId) throw new Error('缺少 COS 上传编号');
    const config = settings();
    const parts = [];
    let marker;
    do {
      const result = await invoke(getClient(config), 'multipartListPart', {
        Bucket: config.bucket, Region: config.region, Key: key, UploadId: uploadId, MaxParts: 1000,
        ...(marker ? { PartNumberMarker: marker } : {}),
      });
      for (const part of result?.Part || []) parts.push({ partNumber: Number(part.PartNumber), etag: part.ETag, sizeBytes: Number(part.Size) });
      marker = result?.IsTruncated ? String(result.NextPartNumberMarker || '') : '';
      if (result?.IsTruncated && !marker) throw new Error('COS 分片列表分页标记缺失');
    } while (marker);
    return parts;
  }

  async function headObject(key) {
    if (!key || key.startsWith('/') || key.split('/').some(part => part === '..')) throw new Error('非法 COS 对象键');
    const config = settings();
    const result = await invoke(getClient(config), 'headObject', { Bucket: config.bucket, Region: config.region, Key: key });
    return { bucket: config.bucket, sizeBytes: Number(result?.headers?.['content-length'] || result?.ContentLength || 0),
      etag: result?.ETag || result?.headers?.etag || null, storageVersionId: result?.VersionId || null,
      contentType: result?.headers?.['content-type'] || result?.ContentType || 'application/octet-stream' };
  }

  async function multipartAbort({ key, uploadId }) {
    if (!key || key.startsWith('/') || key.split('/').some(part => part === '..')) throw new Error('非法 COS 对象键');
    if (!uploadId) return;
    const config = settings();
    await invoke(getClient(config), 'multipartAbort', { Bucket: config.bucket, Region: config.region, Key: key, UploadId: uploadId });
  }

  async function signReadUrl(key, expiresInSec = 60) {
    if (!key || key.startsWith('/') || key.split('/').some(part => part === '..')) {
      throw new Error('非法 COS 对象键');
    }
    const config = settings();
    const result = await invoke(getClient(config), 'getObjectUrl', {
      Bucket: config.bucket,
      Region: config.region,
      Key: key,
      Sign: true,
      Expires: Math.max(1, Math.min(Number(expiresInSec) || 60, 300)),
      Protocol: 'https:',
    });
    if (!result?.Url) throw new Error('COS 没有返回临时访问地址');
    return result.Url;
  }

  function signCdnReadUrl(key, expiresInSec) {
    if (!key || key.startsWith('/') || key.split('/').some(part => part === '..') || !/^[A-Za-z0-9._/-]+$/.test(key)) {
      throw new Error('非法 CDN 对象键');
    }
    const domain = String(env.COS_CDN_DOMAIN || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const authKey = String(env.COS_CDN_AUTH_KEY || '').trim();
    if (!domain || !/^[A-Za-z0-9.-]+(?::\d+)?$/.test(domain) || !/^[A-Za-z0-9]{6,40}$/.test(authKey)) return null;
    // 腾讯云 TypeA 的失效时长由域名侧配置，URL 只能携带签发时间。
    // 将签发时间适当前移，可让单条 URL 的剩余有效时间短于域名最大时长。
    const configuredTtl = Math.max(60, Math.min(Number(env.COS_CDN_AUTH_TTL_SEC) || 3600, 86400));
    const requestedTtl = Math.max(60, Math.min(Number(expiresInSec) || configuredTtl, configuredTtl));
    const timestamp = Math.max(1, Math.floor(Date.now() / 1000) - (configuredTtl - requestedTtl));
    const nonce = randomBytes(12).toString('hex');
    const uri = `/${key.split('/').map(encodeURIComponent).join('/')}`;
    const signature = createHash('md5').update(`${uri}-${timestamp}-${nonce}-0-${authKey}`).digest('hex');
    return `https://${domain}${uri}?sign=${timestamp}-${nonce}-0-${signature}`;
  }

  async function getObjectStream(key, { range } = {}) {
    const signedUrl = await signReadUrl(key);
    const response = await fetch(signedUrl, {
      headers: range ? { Range: range } : undefined,
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      const error = new Error(response.status === 404 ? 'COS 对象不存在' : `COS 读取失败（HTTP ${response.status}）`);
      error.statusCode = response.status;
      throw error;
    }
    return {
      stream: Readable.fromWeb(response.body),
      contentLength: Number(response.headers.get('content-length')) || null,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      statusCode: response.status,
      contentRange: response.headers.get('content-range'),
    };
  }

  async function deleteObject(key) {
    const config = settings();
    await invoke(getClient(config), 'deleteObject', {
      Bucket: config.bucket,
      Region: config.region,
      Key: key,
    });
  }

  return {
    provider: 'cos',
    getBucket() { return settings().bucket; },
    putObject,
    multipartInit,
    multipartUploadPart,
    multipartComplete,
    multipartListParts,
    headObject,
    multipartAbort,
    signReadUrl,
    signCdnReadUrl,
    getObjectStream,
    deleteObject,
  };
}

export function sniffImageMime(buffer) {
  if (!buffer || buffer.length < 12) return 'application/octet-stream';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp';
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70 &&
      buffer[8] === 0x61 && buffer[9] === 0x76 && buffer[10] === 0x69 && buffer[11] === 0x66) return 'image/avif';
  return 'application/octet-stream';
}

export function extForMime(mime) {
  switch (mime) {
    case 'image/jpeg': return '.jpg';
    case 'image/png': return '.png';
    case 'image/gif': return '.gif';
    case 'image/webp': return '.webp';
    case 'image/avif': return '.avif';
    default: return '.bin';
  }
}
