/**
 * 异步生图任务客户端（0046）
 * 流程：POST /api/generation-tasks 提交即返回 taskId（pending），
 *       前端轮询 GET /api/generation-tasks/:id 直到 succeeded/failed/refunded。
 * 目的：避免同步长连接在请求超时后状态不确定；失败/超时由后端自动 refunded 并释放预扣额度。
 */

import i18n from '@canvas/i18n';

const API = import.meta.env.VITE_API_URL || '';

export type GenTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'refunded';

export interface GenTaskOutput {
  type: string;
  index: number;
  b64_json?: string | null;
  url?: string | null;
  fileId?: string | null;
  objectKey?: string | null;
  revisedPrompt?: string | null;
}

export interface GenTask {
  id: string;
  status: GenTaskStatus;
  taskType: string;
  model: string;
  prompt?: string;
  parameters?: Record<string, unknown>;
  outputs: GenTaskOutput[];
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  finishedAt?: string | null;
}

function authHeaders(): Record<string, string> {
  const token =
    localStorage.getItem('billing_token') ||
    localStorage.getItem('token') ||
    localStorage.getItem('admin_token') ||
    '';
  return token
    ? { Authorization: `Bearer ${token}`, 'X-Qingyu-Billing-Token': token }
    : {};
}

/** 把生图页的 ratio/quality 转换成 OpenAI images/generations 认识的取值 */
// 各比例在 1K 档位下的标准像素值（nano-banana 系列仅支持 1K）
const RATIO_SIZE_1K: Record<string, string> = {
  '1:1': '1024x1024',
  '16:9': '1672x941',
  '9:16': '941x1672',
  '4:3': '1443x1090',
  '3:4': '1090x1443',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '5:4': '1408x1120',
  '4:5': '1120x1408',
  '21:9': '1920x832',
};
// gpt-image-2-vip / official 支持 2K/4K
const RATIO_SIZE_2K: Record<string, string> = {
  '1:1': '2048x2048',
  '16:9': '2048x1152',
  '9:16': '1152x2048',
  '4:3': '2304x1728',
  '3:4': '1728x2304',
  '3:2': '2048x1360',
  '2:3': '1360x2048',
  '5:4': '2240x1792',
  '4:5': '1792x2240',
  '21:9': '2912x1248',
};
const RATIO_SIZE_4K: Record<string, string> = {
  '1:1': '2880x2880',
  '16:9': '3840x2160',
  '9:16': '2160x3840',
  '4:3': '3264x2448',
  '3:4': '2448x3264',
  '3:2': '3504x2336',
  '2:3': '2336x3504',
  '5:4': '3200x2560',
  '4:5': '2560x3200',
  '21:9': '3840x1648',
};

export function resolveOpenImageParams(opts: {
  ratio?: string;
  quality?: string;
  model?: string;
}): { size?: string; quality?: string; resolution?: string } {
  const out: { size?: string; quality?: string; resolution?: string } = {};
  const ratio = (opts.ratio || '').toLowerCase();
  const model = (opts.model || '').toLowerCase();
  const q = (opts.quality || '').toLowerCase();

  // nano-banana 系列：只支持 1K，size 传像素值，不支持 resolution 参数
  if (model.includes('nano-banana')) {
    out.size = RATIO_SIZE_1K[ratio] || '1024x1024';
    return out;
  }

  // gpt-image-2 系列：size 直接传比例字符串，resolution 传档位
  if (model.includes('gpt-image-2')) {
    if (ratio && ratio !== '__orig__') out.size = ratio;
    else out.size = '1:1';
    if (q === '2k' || q === '4k') out.resolution = q.toUpperCase();
    else out.resolution = '1K';
    return out;
  }

  // 默认：1K 像素值
  out.size = RATIO_SIZE_1K[ratio] || '1024x1024';
  return out;
}

export async function submitImageTask(body: Record<string, unknown>): Promise<{ taskId: string; status: string }> {
  const idempotencyKey = String(body.idempotencyKey || `image-task:${crypto.randomUUID()}`);
  const res = await fetch(`${API}/api/generation-tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ...body, idempotencyKey }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof data?.error === 'string' ? data.error : data?.error?.message || i18n.t('imageTools.submitFailed'),
    );
  }
  return data;
}

export async function fetchTask(taskId: string): Promise<GenTask> {
  const res = await fetch(`${API}/api/generation-tasks/${encodeURIComponent(taskId)}`, {
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : i18n.t('imageTools.taskQueryFailed'));
  return data as GenTask;
}

/** 拉取当前用户最近的生图任务（"我的生成"） */
export async function listImageTasks(limit = 50): Promise<GenTask[]> {
  const res = await fetch(`${API}/api/generation-tasks?limit=${encodeURIComponent(limit)}`, {
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : i18n.t('imageTools.historyQueryFailed'));
  return (Array.isArray(data) ? data : data.tasks || []) as GenTask[];
}

export async function pollImageTask(
  taskId: string,
  options: { intervalMs?: number; timeoutMs?: number; onTick?: (t: GenTask) => void } = {},
): Promise<GenTask> {
  const intervalMs = options.intervalMs ?? 1500;
  const timeoutMs = options.timeoutMs ?? 600000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const task = await fetchTask(taskId);
    options.onTick?.(task);
    if (task.status === 'succeeded' || task.status === 'failed' || task.status === 'refunded') return task;
    if (Date.now() > deadline) throw new Error(i18n.t('imageTools.pollTimeout'));
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** 把任务输出转成可直接渲染的图片 URL 列表。
 *  - 新数据：fileId 存在时走后端流式接口（带 ?token= 供 <img> 标签鉴权）
 *  - 老数据 fallback：b64_json 拼成 dataURL，或直接用上游返回的 url
 */
export function taskOutputToDataUrls(task: GenTask): string[] {
  const token =
    localStorage.getItem('billing_token') ||
    localStorage.getItem('token') ||
    localStorage.getItem('admin_token') ||
    '';
  return (task.outputs || [])
    .filter((o) => o.b64_json || o.url || o.fileId)
    .map((o) => {
      if (o.fileId) {
        const q = token ? `?token=${encodeURIComponent(token)}` : '';
        return `${API}/api/generation-tasks/${task.id}/outputs/${o.index}/content${q}`;
      }
      return o.b64_json ? `data:image/png;base64,${o.b64_json}` : (o.url as string);
    });
}
