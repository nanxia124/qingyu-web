/**
 * 异步生图任务客户端（0046）
 * 流程：POST /api/generation-tasks 提交即返回 taskId（pending），
 *       前端轮询 GET /api/generation-tasks/:id 直到 succeeded/failed/refunded。
 * 目的：避免同步长连接在请求超时后状态不确定；失败/超时由后端自动 refunded 并释放预扣额度。
 */

const API = import.meta.env.VITE_API_URL || '';

export type GenTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'refunded';

export interface GenTaskOutput {
  type: string;
  index: number;
  b64_json?: string | null;
  url?: string | null;
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
export function resolveOpenImageParams(opts: {
  ratio?: string;
  quality?: string;
}): { size?: string; quality?: string } {
  const out: { size?: string; quality?: string } = {};
  const ratio = (opts.ratio || '').toLowerCase();
  if (ratio === '16:9' || ratio === '3:2' || ratio === '4:3') out.size = '1536x1024';
  else if (ratio === '9:16' || ratio === '2:3' || ratio === '3:4') out.size = '1024x1536';
  else out.size = '1024x1024';
  const q = (opts.quality || '').toLowerCase();
  if (q === '2k' || q === '4k' || q === 'high' || q === 'hd') out.quality = 'hd';
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
      typeof data?.error === 'string' ? data.error : data?.error?.message || `提交失败 (${res.status})`,
    );
  }
  return data;
}

export async function fetchTask(taskId: string): Promise<GenTask> {
  const res = await fetch(`${API}/api/generation-tasks/${encodeURIComponent(taskId)}`, {
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `查询任务失败 (${res.status})`);
  return data as GenTask;
}

/** 拉取当前用户最近的生图任务（"我的生成"） */
export async function listImageTasks(limit = 50): Promise<GenTask[]> {
  const res = await fetch(`${API}/api/generation-tasks?limit=${encodeURIComponent(limit)}`, {
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "查询历史失败");
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
    if (Date.now() > deadline) throw new Error('生成时间较长，结果稍后会出现在历史记录中');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** 把任务输出转成可直接渲染的 dataUrl 列表 */
export function taskOutputToDataUrls(task: GenTask): string[] {
  return (task.outputs || [])
    .filter((o) => !!o.b64_json)
    .map((o) => `data:image/png;base64,${o.b64_json}`);
}
