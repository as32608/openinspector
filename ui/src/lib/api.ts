import type {
  MetricsResponse,
  LogsResponse,
  TraceResponse,
  RawLogData,
  SettingsResponse,
  AppsResponse,
  AppConfig,
} from '../types';

// Relative path: the UI is served by nginx, which reverse-proxies /api to the
// dashboard API on the same origin (see ui/nginx.conf). This avoids hardcoding
// the host and removes the need for CORS.
const API_BASE = '/api';

// Parse a JSON response, throwing a descriptive error on non-2xx so callers'
// catch blocks fire (and surface a toast) instead of silently consuming an
// error body as data.
async function jsonOrThrow<T>(res: Response, action: string): Promise<T> {
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.detail ? `: ${body.detail}` : '';
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`Failed to ${action} (HTTP ${res.status})${detail}`);
  }
  return res.json() as Promise<T>;
}

// Assert a mutation succeeded; for endpoints whose body we don't use.
function assertOk(res: Response, action: string): void {
  if (!res.ok) throw new Error(`Failed to ${action} (HTTP ${res.status})`);
}

// ============================================================
// Metrics
// ============================================================

export async function fetchMetrics(appFilter?: string): Promise<MetricsResponse> {
  const params = new URLSearchParams();
  if (appFilter) params.set('app', appFilter);
  const res = await fetch(`${API_BASE}/metrics?${params}`);
  return jsonOrThrow(res, 'load metrics');
}

// ============================================================
// Logs
// ============================================================

export async function fetchLogs(opts: {
  limit?: number;
  offset?: number;
  search?: string;
  view?: string;
  app?: string;
  status?: string;
}): Promise<LogsResponse> {
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.offset) params.set('offset', String(opts.offset));
  if (opts.search) params.set('search', opts.search);
  if (opts.view) params.set('view', opts.view);
  if (opts.app) params.set('app', opts.app);
  if (opts.status) params.set('status', opts.status);
  const res = await fetch(`${API_BASE}/logs?${params}`);
  return jsonOrThrow(res, 'load logs');
}

export async function fetchTrace(logId: number): Promise<TraceResponse> {
  const res = await fetch(`${API_BASE}/traces/${logId}`);
  return jsonOrThrow(res, 'load trace');
}

export async function fetchRawLog(logId: number): Promise<RawLogData> {
  const res = await fetch(`${API_BASE}/logs/${logId}/raw`);
  return jsonOrThrow(res, 'load raw data');
}

export async function deleteLog(logId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/logs/${logId}`, { method: 'DELETE' });
  assertOk(res, 'delete log');
}

export async function bulkDeleteLogs(ids: number[]): Promise<{ count: number }> {
  const res = await fetch(`${API_BASE}/logs/bulk-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  return jsonOrThrow(res, 'delete logs');
}

// ============================================================
// Settings
// ============================================================

export async function fetchSettings(): Promise<SettingsResponse> {
  const res = await fetch(`${API_BASE}/settings`);
  return jsonOrThrow(res, 'load settings');
}

export async function updateSettings(settings: Record<string, string>): Promise<void> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  });
  assertOk(res, 'update settings');
}

// ============================================================
// Apps
// ============================================================

export async function fetchApps(): Promise<AppsResponse> {
  const res = await fetch(`${API_BASE}/apps`);
  return jsonOrThrow(res, 'load apps');
}

export async function createApp(app: Omit<AppConfig, 'id' | 'created_at'>): Promise<AppConfig> {
  const res = await fetch(`${API_BASE}/apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(app),
  });
  return jsonOrThrow(res, 'create app');
}

export async function updateApp(
  appId: number,
  updates: Partial<Omit<AppConfig, 'id' | 'created_at'>>
): Promise<AppConfig> {
  const res = await fetch(`${API_BASE}/apps/${appId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return jsonOrThrow(res, 'update app');
}

export async function deleteApp(appId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/apps/${appId}`, { method: 'DELETE' });
  assertOk(res, 'delete app');
}

// ============================================================
// Export
// ============================================================

export function getExportUrl(range: string, customStart?: string, customEnd?: string): string {
  let url = `${API_BASE}/export/finetune`;
  if (range === 'custom' && customStart && customEnd) {
    const start = new Date(customStart).toISOString();
    const end = new Date(customEnd);
    end.setHours(23, 59, 59, 999);
    url += `?start_date=${start}&end_date=${end.toISOString()}`;
  } else if (range !== 'all') {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (range === '7d' ? 7 : 30));
    url += `?start_date=${start.toISOString()}&end_date=${end.toISOString()}`;
  }
  return url;
}
