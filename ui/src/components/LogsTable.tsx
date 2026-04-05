import { useState } from 'react';
import { Search, ListFilter, ChevronRight, Wrench, MoreVertical, Trash2, FileJson2, RefreshCw, CheckSquare, Square } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { motion, AnimatePresence } from 'framer-motion';
import type { LogEntry, ViewMode, AppConfig } from '../types';

interface LogsTableProps {
  logs: LogEntry[];
  totalLogs: number;
  page: number;
  pageSize: number;
  viewMode: ViewMode;
  searchTerm: string;
  expandedLogId: number | null;
  appFilter: string;
  apps: AppConfig[];
  liveMode: boolean;
  onPageChange: (page: number) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onSearchChange: (term: string) => void;
  onExpandLog: (id: number) => void;
  onViewRaw: (id: number) => void;
  onDeleteLog: (id: number) => void;
  onBulkDelete: (ids: number[]) => void;
  onAppFilterChange: (slug: string) => void;
  onLiveModeToggle: () => void;
  children?: React.ReactNode; // For trace content
}

function getPreviewText(content: any): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b: any) => b.text || (typeof b.content === 'string' ? b.content : '')).join(' ');
  }
  return JSON.stringify(content);
}

export default function LogsTable({
  logs,
  totalLogs,
  page,
  pageSize,
  viewMode,
  searchTerm,
  expandedLogId,
  appFilter,
  apps,
  liveMode,
  onPageChange,
  onViewModeChange,
  onSearchChange,
  onExpandLog,
  onViewRaw,
  onDeleteLog,
  onBulkDelete,
  onAppFilterChange,
  onLiveModeToggle,
  children,
}: LogsTableProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const toggleSelect = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleAll = () => {
    if (selectedIds.size === logs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(logs.map(l => l.id)));
    }
  };

  const handleBulkDelete = () => {
    onBulkDelete(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  return (
    <div className="glass-card overflow-hidden">
      {/* Toolbar */}
      <div className="px-5 py-3.5 border-b border-border flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3">
        {/* Left: View Toggles + App Filter */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center bg-bg-elevated/80 p-0.5 rounded-lg">
            <button
              onClick={() => onViewModeChange('trace')}
              className={`flex items-center px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${
                viewMode === 'trace'
                  ? 'bg-accent-blue/20 text-accent-blue shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <ListFilter className="w-3.5 h-3.5 mr-1.5" />
              Traces
            </button>
            <button
              onClick={() => onViewModeChange('plain')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${
                viewMode === 'plain'
                  ? 'bg-accent-blue/20 text-accent-blue shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              All Requests
            </button>
          </div>

          {/* App Filter */}
          {apps.length > 0 && (
            <select
              value={appFilter}
              onChange={(e) => onAppFilterChange(e.target.value)}
              className="bg-bg-elevated/80 text-text-secondary text-xs px-3 py-1.5 rounded-lg border border-border focus:border-border-focus focus:outline-none appearance-none cursor-pointer"
            >
              <option value="">All Apps</option>
              {apps.map(a => (
                <option key={a.slug} value={a.slug}>
                  {a.name} {a.is_default ? '(default)' : ''}
                </option>
              ))}
            </select>
          )}

          {/* Live toggle */}
          <button
            onClick={onLiveModeToggle}
            className={`flex items-center px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 border ${
              liveMode
                ? 'bg-accent-emerald/10 text-accent-emerald border-accent-emerald/30'
                : 'bg-bg-elevated/80 text-text-muted border-border hover:text-text-secondary'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${liveMode ? 'animate-spin' : ''}`} style={liveMode ? { animationDuration: '3s' } : {}} />
            Live
          </button>
        </div>

        {/* Right: Search + Pagination */}
        <div className="flex items-center gap-3 w-full lg:w-auto">
          <div className="relative flex-1 lg:w-56">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-text-muted" />
            <input
              type="text"
              placeholder="Search traces..."
              className="w-full pl-8 pr-4 py-2 bg-bg-elevated/80 border border-border rounded-lg text-xs text-text-primary placeholder:text-text-dim focus:ring-1 focus:ring-border-focus focus:border-border-focus outline-none transition-colors"
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted whitespace-nowrap">
              {totalLogs === 0 ? 0 : page * pageSize + 1}–{Math.min((page + 1) * pageSize, totalLogs)} of {totalLogs}
            </span>
            <div className="flex gap-0.5">
              <button
                onClick={() => onPageChange(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-2 py-1 border border-border rounded-md text-xs text-text-secondary hover:bg-bg-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Prev
              </button>
              <button
                onClick={() => onPageChange(page + 1)}
                disabled={(page + 1) * pageSize >= totalLogs}
                className="px-2 py-1 border border-border rounded-md text-xs text-text-secondary hover:bg-bg-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bulk actions bar */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 py-2 bg-accent-red/5 border-b border-accent-red/20 flex items-center justify-between">
              <span className="text-xs text-accent-red font-medium">
                {selectedIds.size} selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleBulkDelete}
                  className="flex items-center px-3 py-1 bg-accent-red/10 text-accent-red text-xs font-medium rounded-md hover:bg-accent-red/20 transition-colors"
                >
                  <Trash2 className="w-3 h-3 mr-1" />
                  Delete Selected
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-text-muted text-xs hover:text-text-secondary transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Column header */}
      <div className="px-5 py-2 border-b border-border bg-bg-surface/30 flex items-center text-[10px] text-text-dim uppercase tracking-wider font-semibold">
        <div className="w-8 flex-shrink-0">
          <button onClick={toggleAll} className="text-text-muted hover:text-text-secondary transition-colors">
            {selectedIds.size === logs.length && logs.length > 0 ? (
              <CheckSquare className="w-3.5 h-3.5" />
            ) : (
              <Square className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
        <div className="w-6 flex-shrink-0"></div>
        <div className="w-16 flex-shrink-0">Status</div>
        <div className="w-24 flex-shrink-0">Time</div>
        <div className="flex-1 min-w-0">Summary</div>
        <div className="w-20 flex-shrink-0 text-right">App</div>
        <div className="w-36 flex-shrink-0 text-right">Model</div>
        <div className="w-16 flex-shrink-0 text-right">Duration</div>
        <div className="w-8 flex-shrink-0"></div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-border">
        {logs.length === 0 ? (
          <div className="p-12 text-center text-text-muted text-sm">
            No requests found for this filter.
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex flex-col">
              <div
                className={`px-5 py-3 flex items-center cursor-pointer transition-all duration-200 group ${
                  expandedLogId === log.id
                    ? 'bg-accent-blue/5'
                    : 'hover:bg-bg-elevated/40'
                }`}
                onClick={() => onExpandLog(log.id)}
              >
                {/* Checkbox */}
                <div className="w-8 flex-shrink-0" onClick={(e) => toggleSelect(log.id, e)}>
                  {selectedIds.has(log.id) ? (
                    <CheckSquare className="w-3.5 h-3.5 text-accent-blue" />
                  ) : (
                    <Square className="w-3.5 h-3.5 text-text-dim group-hover:text-text-muted transition-colors" />
                  )}
                </div>

                {/* Chevron */}
                <div className="w-6 flex-shrink-0">
                  <ChevronRight
                    className={`w-4 h-4 text-text-dim transform transition-transform duration-200 ${
                      expandedLogId === log.id ? 'rotate-90 text-accent-blue' : ''
                    }`}
                  />
                </div>

                {/* Status */}
                <div className="w-16 flex-shrink-0">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-full ${
                      log.response_status_code >= 200 && log.response_status_code < 300
                        ? 'bg-accent-emerald/10 text-accent-emerald'
                        : log.response_status_code >= 400
                          ? 'bg-accent-red/10 text-accent-red'
                          : 'bg-accent-amber/10 text-accent-amber'
                    }`}
                  >
                    <span
                      className={`status-dot mr-1.5 ${
                        log.response_status_code >= 200 && log.response_status_code < 300
                          ? 'bg-accent-emerald'
                          : log.response_status_code >= 400
                            ? 'bg-accent-red'
                            : 'bg-accent-amber'
                      }`}
                    />
                    {log.response_status_code}
                  </span>
                </div>

                {/* Time */}
                <div className="w-24 flex-shrink-0 text-xs text-text-secondary">
                  {new Date(log.created_at).toLocaleTimeString()}
                </div>

                {/* Summary */}
                <div className="flex-1 min-w-0 text-sm truncate pr-4 text-text-secondary">
                  {log.parsed_tools.length > 0 && (
                    <span className="inline-flex items-center bg-accent-purple/10 text-accent-purple px-1.5 py-0.5 rounded text-[10px] mr-2 font-medium">
                      <Wrench className="w-2.5 h-2.5 mr-1" />
                      {log.parsed_tools.map((t) => t.name).join(', ')}
                    </span>
                  )}
                  <span className="text-text-secondary/80">
                    {log.final_text
                      ? log.final_text.substring(0, 100)
                      : getPreviewText(log.request_body?.messages?.slice(-1)[0]?.content)?.substring(0, 100) || 'Streaming Session'}
                  </span>
                </div>

                {/* App */}
                <div className="w-20 flex-shrink-0 text-right">
                  {log.app_slug && log.app_slug !== 'default' && (
                    <span className="inline-block bg-accent-cyan/10 text-accent-cyan text-[10px] px-1.5 py-0.5 rounded font-medium">
                      {log.app_slug}
                    </span>
                  )}
                </div>

                {/* Model */}
                <div className="w-36 flex-shrink-0 text-right">
                  <span className="font-mono text-[11px] text-text-muted bg-bg-elevated px-2 py-0.5 rounded truncate inline-block max-w-full">
                    {log.request_body?.model || '—'}
                  </span>
                </div>

                {/* Duration */}
                <div className="w-16 flex-shrink-0 text-right font-mono text-xs text-text-muted">
                  {log.duration_sec?.toFixed(2)}s
                </div>

                {/* Actions */}
                <div className="w-8 flex-shrink-0 flex justify-end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button className="p-1 rounded-md text-text-dim hover:text-text-secondary hover:bg-bg-elevated transition-colors opacity-0 group-hover:opacity-100">
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        className="bg-bg-elevated border border-border-light rounded-lg shadow-xl py-1 min-w-[140px] z-50"
                        sideOffset={5}
                        align="end"
                      >
                        <DropdownMenu.Item
                          className="flex items-center px-3 py-2 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary cursor-pointer outline-none transition-colors"
                          onClick={() => onViewRaw(log.id)}
                        >
                          <FileJson2 className="w-3.5 h-3.5 mr-2" />
                          View Raw Data
                        </DropdownMenu.Item>
                        <DropdownMenu.Separator className="h-px bg-border my-1" />
                        <DropdownMenu.Item
                          className="flex items-center px-3 py-2 text-xs text-accent-red hover:bg-accent-red/10 cursor-pointer outline-none transition-colors"
                          onClick={() => onDeleteLog(log.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-2" />
                          Delete
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </div>
              </div>

              {/* Expanded content (trace). Rendered by parent via children pattern */}
              <AnimatePresence>
                {expandedLogId === log.id && children && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    {children}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
