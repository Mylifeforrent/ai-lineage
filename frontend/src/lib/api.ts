import type {
  DatasetSummary,
  LineageGraph,
  LoginResponse,
  PreviewResponse,
  Session,
} from '../types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export const SESSION_STORAGE_KEY = 'lineagelite.session';
export const AUTH_EXPIRED_EVENT = 'lineagelite:auth-expired';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function readErrorDetail(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (Array.isArray(detail)) {
      const messages = detail
        .map((item) => {
          if (item && typeof item === 'object' && 'msg' in item) {
            return String((item as { msg: unknown }).msg);
          }
          return '';
        })
        .filter(Boolean);
      if (messages.length) return messages.join('；');
    }
  }
  if (status === 401) return '登录已过期，请重新登录';
  if (status === 403) return '当前账号无权执行此操作';
  if (status === 404) return '请求的资源不存在';
  if (status === 409) return '定位已失效';
  if (status === 422) return '请求参数不合法';
  return `请求失败（HTTP ${status}）`;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // 非 JSON 错误体内不保留原始文本，避免把 HTML 错误页直接展示给用户。
    }
    if (response.status === 401 && token) {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    }
    throw new ApiError(response.status, readErrorDetail(payload, response.status));
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function loadSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as Session).access_token === 'string' &&
      typeof (parsed as Session).username === 'string' &&
      typeof (parsed as Session).role === 'string'
    ) {
      return parsed as Session;
    }
  } catch {
    // 损坏的本地会话直接丢弃。
  }
  return null;
}

export function persistSession(session: Session): void {
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // 隐私模式或配额不足时仍允许当前页面使用会话。
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // 清理失败不阻塞退出流程。
  }
}

export async function login(
  username: string,
  password: string,
  signal?: AbortSignal,
): Promise<LoginResponse> {
  return request<LoginResponse>(
    '/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      signal,
    },
  );
}

export async function getDatasets(
  token: string,
  signal?: AbortSignal,
): Promise<DatasetSummary[]> {
  return request<DatasetSummary[]>('/datasets', { signal }, token);
}

export interface SubgraphParams {
  dataset: string;
  field?: string;
  hops: number;
  direction?: 'both' | 'up' | 'down';
}

export async function getSubgraph(
  token: string,
  params: SubgraphParams,
  signal?: AbortSignal,
): Promise<LineageGraph> {
  const search = new URLSearchParams({
    dataset: params.dataset,
    hops: String(params.hops),
    direction: params.direction ?? 'both',
  });
  if (params.field) search.set('field', params.field);
  return request<LineageGraph>(
    `/lineage/subgraph?${search.toString()}`,
    { signal },
    token,
  );
}

export async function getFieldPreview(
  token: string,
  datasetId: string,
  fieldName: string,
  signal?: AbortSignal,
): Promise<PreviewResponse> {
  return request<PreviewResponse>(
    `/fields/${encodeURIComponent(datasetId)}/${encodeURIComponent(fieldName)}/preview`,
    { signal },
    token,
  );
}

/** 受控下载托管源文件；存储路径不经前端，只接受源文件 ID。 */
export async function downloadSourceFile(
  token: string,
  fileId: number,
  filename: string,
): Promise<void> {
  const response = await fetch(`${API_BASE}/files/${fileId}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // 下载失败且无可解析错误体时使用通用提示
    }
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    }
    throw new ApiError(
      response.status,
      readErrorDetail(payload, response.status),
    );
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
