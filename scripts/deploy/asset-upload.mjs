// 用户文件从 HTTP 请求流直接传给对象存储，不在服务器磁盘暂存。
export const MAX_ASSET_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
export const ASSET_PREVIEW_VARIANTS = Object.freeze(['thumbnail', 'video-cover']);

export function isAssetPreviewVariant(value) {
  return ASSET_PREVIEW_VARIANTS.includes(String(value || ''));
}

export function validateUploadSessionSize(value) {
  const sizeBytes = Number(value);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_ASSET_UPLOAD_BYTES) {
    throw new Error('文件大小必须大于0且不能超过5120MB');
  }
  return sizeBytes;
}

export function buildAssetObjectKey({ workspaceId, sourceKind, mediaType, createdAt = new Date(), groupingId, fileId, extension = '', sourceFileId, previewVariant }) {
  if (sourceKind === 'derived') {
    if (!workspaceId || !fileId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(sourceFileId || ''))
      || !isAssetPreviewVariant(previewVariant) || mediaType !== 'image') {
      throw new Error('预览文件必须是图片，并提供有效的原文件编号和预览规格');
    }
    const safeExtension = String(extension).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 16);
    return `workspaces/${workspaceId}/previews/${sourceFileId}/${previewVariant}/${fileId}${safeExtension}`;
  }
  const roots = { generated: 'generated', reference_upload: 'references', manual_upload: 'uploads', edited: 'edits' };
  const categories = { image: 'images', video: 'videos', audio: 'audio', text: 'text', document: 'documents', other: 'other' };
  const root = roots[sourceKind];
  const category = categories[mediaType];
  if (!workspaceId || !root || !category || !groupingId || !fileId || !(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) {
    throw new Error('文件保存分类或分组信息无效');
  }
  const safeExtension = String(extension).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 16);
  const year = String(createdAt.getUTCFullYear());
  const month = String(createdAt.getUTCMonth() + 1).padStart(2, '0');
  return `workspaces/${workspaceId}/${root}/${category}/${year}/${month}/${groupingId}/${fileId}${safeExtension}`;
}

export async function writeAssetUpload(input, objectStore, key, contentType, maxBytes = MAX_ASSET_UPLOAD_BYTES) {
  const contentLength = Number(input.headers?.['content-length']);
  if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
    input.resume?.();
    throw new Error('上传请求必须包含有效的文件大小');
  }
  if (contentLength > maxBytes) {
    input.resume?.();
    throw new Error(`单个文件不能超过${Math.floor(maxBytes / 1024 / 1024)}MB`);
  }
  try {
    const result = await objectStore.putObject({
      key,
      body: input,
      contentLength,
      contentType,
      maxBytes,
    });
    return { ...result, checksum: result.sha256 };
  } catch (error) {
    if (!input.destroyed) input.resume?.();
    throw error;
  }
}
