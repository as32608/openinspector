import type {
  MetricsResponse,
  LogsResponse,
  TraceResponse,
  RawLogData,
  SettingsResponse,
  AppsResponse,
  AppConfig,
} from '../types';

const API_BASE = 'http://localhost:8081/api';

// ============================================================
// Metrics
// ============================================================

export async function fetchMetrics(appFilter?: string): Promise<MetricsResponse> {
  const params = new URLSearchParams();
  if (appFilter) params.set('app', appFilter);
  const res = await fetch(`${API_BASE}/metrics?${params}`);
  return res.json();
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
  return res.json();
}

export async function fetchTrace(logId: number): Promise<TraceResponse> {
  const res = await fetch(`${API_BASE}/traces/${logId}`);
  return res.json();
}

export async function fetchRawLog(logId: number): Promise<RawLogData> {
  const res = await fetch(`${API_BASE}/logs/${logId}/raw`);
  return res.json();
}

export async function deleteLog(logId: number): Promise<void> {
  await fetch(`${API_BASE}/logs/${logId}`, { method: 'DELETE' });
}

export async function bulkDeleteLogs(ids: number[]): Promise<{ count: number }> {
  const res = await fetch(`${API_BASE}/logs/bulk-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  return res.json();
}

// ============================================================
// Settings
// ============================================================

export async function fetchSettings(): Promise<SettingsResponse> {
  const res = await fetch(`${API_BASE}/settings`);
  return res.json();
}

export async function updateSettings(settings: Record<string, string>): Promise<void> {
  await fetch(`${API_BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  });
}

// ============================================================
// Apps
// ============================================================

export async function fetchApps(): Promise<AppsResponse> {
  const res = await fetch(`${API_BASE}/apps`);
  return res.json();
}

export async function createApp(app: Omit<AppConfig, 'id' | 'created_at'>): Promise<AppConfig> {
  const res = await fetch(`${API_BASE}/apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(app),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || 'Failed to create app');
  }
  return res.json();
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
  return res.json();
}

export async function deleteApp(appId: number): Promise<void> {
  await fetch(`${API_BASE}/apps/${appId}`, { method: 'DELETE' });
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
