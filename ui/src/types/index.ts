// ============================================================
// API Response Types
// ============================================================

export interface MetricsSummary {
  total_requests: number;
  avg_latency: number | null;
  error_count: number;
}

export interface ChartDataPoint {
  date: string;
  requests: number;
  latency: number;
}

export interface AppBreakdown {
  app_slug: string;
  total_requests: number;
  error_count: number;
}

export interface MetricsResponse {
  summary: MetricsSummary;
  chart_data: ChartDataPoint[];
  app_breakdown: AppBreakdown[];
}

export interface LogEntry {
  id: number;
  method: string;
  response_status_code: number;
  duration_sec: number | null;
  final_text: string;
  created_at: string;
  tool_calls: string;
  request_body: Record<string, any>;
  parsed_tools: ToolCall[];
  final_reasoning_text: string;
  app_slug: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: any;
}

export interface LogsResponse {
  total: number;
  logs: LogEntry[];
}

export interface TraceStep {
  id: number;
  method: string;
  response_status_code: number;
  duration_sec: number | null;
  final_text: string;
  final_reasoning_text: string;
  created_at: string;
  parsed_req: Record<string, any>;
  parsed_tools: ToolCall[];
  response_body_raw: string;
  app_slug: string;
  [key: string]: any;
}

export interface TraceResponse {
  clicked_log_id: number;
  clicked_log: TraceStep;
  chain: TraceStep[];
}

export interface RawLogData {
  id: number;
  url: string;
  method: string;
  query_params: any;
  request_headers: any;
  request_content_type: string;
  request_body_raw: string;
  request_body_json: any;
  response_status_code: number;
  response_headers: any;
  response_content_type: string;
  response_body_raw: string;
  response_body_json: any;
  final_text: string;
  final_reasoning_text: string;
  tool_calls: any;
  duration_sec: number;
  created_at: string;
  app_slug: string;
}

// ============================================================
// Settings & Apps
// ============================================================

export interface Setting {
  key: string;
  value: string;
  updated_at: string;
}

export interface SettingsResponse {
  settings: Setting[];
}

export interface AppConfig {
  id: number;
  slug: string;
  name: string;
  target_url: string;
  is_default: boolean;
  created_at: string;
}

export interface AppsResponse {
  apps: AppConfig[];
}

// ============================================================
// UI State
// ============================================================

export type ViewMode = 'trace' | 'plain';
export type PageView = 'logs' | 'settings' | 'apps';
export type ExportRange = '7d' | '30d' | 'all' | 'custom';
