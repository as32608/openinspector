import { useEffect, useState, useCallback, useRef } from 'react';
import { Download, Menu } from 'lucide-react';
import { Toaster, toast } from 'sonner';

import Sidebar from './components/Sidebar';
import MetricsBar from './components/MetricsBar';
import LogsTable from './components/LogsTable';
import TraceTimeline from './components/TraceTimeline';
import RawDataDrawer from './components/RawDataDrawer';
import SettingsPanel from './components/SettingsPanel';
import AppsManager from './components/AppsManager';
import ExportModal from './components/ExportModal';

import {
  fetchMetrics,
  fetchLogs,
  fetchTrace,
  fetchRawLog,
  deleteLog,
  bulkDeleteLogs,
  fetchApps,
} from './lib/api';

import type {
  MetricsSummary,
  LogEntry,
  TraceResponse,
  RawLogData,
  ViewMode,
  PageView,
  AppConfig,
} from './types';

const PAGE_SIZE = 50;

export default function App() {
  // --- Navigation ---
  const [currentView, setCurrentView] = useState<PageView>('logs');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  // --- Data ---
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalLogs, setTotalLogs] = useState(0);
  const [traceData, setTraceData] = useState<TraceResponse | null>(null);
  const [rawLogData, setRawLogData] = useState<RawLogData | null>(null);
  const [apps, setApps] = useState<AppConfig[]>([]);

  // --- Filters ---
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('trace');
  const [appFilter, setAppFilter] = useState('');
  const [errorFilterActive, setErrorFilterActive] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);

  // --- UI State ---
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [rawDrawerOpen, setRawDrawerOpen] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Search debounce ---
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const handleSearchChange = useCallback((term: string) => {
    setSearchTerm(term);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearch(term);
      setPage(0);
    }, 300);
  }, []);

  // --- Data Fetching ---
  const loadMetrics = useCallback(async () => {
    try {
      const data = await fetchMetrics(appFilter);
      setMetrics(data.summary);
    } catch (e) {
      console.error('Failed to load metrics', e);
      toast.error('Failed to load metrics');
    }
  }, [appFilter]);

  const loadLogs = useCallback(async () => {
    try {
      const data = await fetchLogs({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        search: debouncedSearch,
        view: viewMode,
        app: appFilter,
        status: errorFilterActive ? 'error' : '',
      });
      setLogs(data.logs);
      setTotalLogs(data.total);
    } catch (e) {
      console.error('Failed to load logs', e);
      toast.error('Failed to load logs');
    }
  }, [page, debouncedSearch, viewMode, appFilter, errorFilterActive]);

  const loadApps = useCallback(async () => {
    try {
      const data = await fetchApps();
      setApps(data.apps);
    } catch (e) {
      console.error('Failed to load apps', e);
      toast.error('Failed to load apps');
    }
  }, []);

  // --- Initial Load ---
  useEffect(() => {
    loadMetrics();
    loadApps();
  }, []);

  useEffect(() => {
    loadLogs();
    setExpandedLogId(null);
    setTraceData(null);
  }, [loadLogs]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  // --- Live Mode ---
  useEffect(() => {
    if (liveMode) {
      liveIntervalRef.current = setInterval(() => {
        // Skip polling while the tab is backgrounded — no point fetching data
        // nobody is looking at, and it avoids needless DB load.
        if (document.hidden) return;
        loadLogs();
        loadMetrics();
      }, 5000);

      // Refresh immediately when the user returns to the tab.
      const onVisible = () => {
        if (!document.hidden) {
          loadLogs();
          loadMetrics();
        }
      };
      document.addEventListener('visibilitychange', onVisible);
      return () => {
        document.removeEventListener('visibilitychange', onVisible);
        if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
      };
    } else {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
    }
    return () => {
      if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
    };
  }, [liveMode, loadLogs, loadMetrics]);

  // --- Handlers ---
  const handleExpandLog = async (id: number) => {
    if (expandedLogId === id) {
      setExpandedLogId(null);
      setTraceData(null);
      return;
    }
    setExpandedLogId(id);
    try {
      const data = await fetchTrace(id);
      setTraceData(data);
    } catch (e) {
      toast.error('Failed to load trace');
    }
  };

  const handleViewRaw = async (id: number) => {
    setRawLogData(null);
    setRawDrawerOpen(true);
    try {
      const data = await fetchRawLog(id);
      setRawLogData(data);
    } catch (e) {
      toast.error('Failed to load raw data');
    }
  };

  const handleDeleteLog = async (id: number) => {
    try {
      await deleteLog(id);
      toast.success(`Log #${id} deleted`);
      loadLogs();
      loadMetrics();
    } catch (e) {
      toast.error('Failed to delete log');
    }
  };

  const handleBulkDelete = async (ids: number[]) => {
    try {
      const result = await bulkDeleteLogs(ids);
      toast.success(`${result.count} logs deleted`);
      loadLogs();
      loadMetrics();
    } catch (e) {
      toast.error('Failed to delete logs');
    }
  };

  const handleToggleErrorFilter = () => {
    setErrorFilterActive((prev) => !prev);
    setPage(0);
  };

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    setPage(0);
  };

  const handleAppFilterChange = (slug: string) => {
    setAppFilter(slug);
    setPage(0);
  };

  return (
    <div className="min-h-screen gradient-bg">
      <Toaster
        position="top-right"
        theme="dark"
        toastOptions={{
          style: {
            background: 'rgba(17, 24, 39, 0.9)',
            border: '1px solid rgba(255,255,255,0.06)',
            color: '#f1f5f9',
            backdropFilter: 'blur(12px)',
          },
        }}
      />

      {/* Sidebar */}
      <Sidebar
        currentView={currentView}
        onNavigate={setCurrentView}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Main content area */}
      <main className={`transition-all duration-300 ${sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64'}`}>
        {/* Top bar */}
        <header className="sticky top-0 z-30 h-16 flex items-center justify-between px-6 border-b border-border bg-bg-deep/80 backdrop-blur-xl">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold text-text-primary hidden sm:block">
              {currentView === 'logs' ? 'Traces & Logs' : currentView === 'settings' ? 'Settings' : 'App Routes'}
            </h2>
          </div>

          {currentView === 'logs' && (
            <button
              onClick={() => setExportModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-border text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export JSONL</span>
            </button>
          )}
        </header>

        {/* Page content */}
        <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
          {currentView === 'logs' && (
            <>
              <MetricsBar
                metrics={metrics}
                errorFilterActive={errorFilterActive}
                onToggleErrorFilter={handleToggleErrorFilter}
              />

              <LogsTable
                logs={logs}
                totalLogs={totalLogs}
                page={page}
                pageSize={PAGE_SIZE}
                viewMode={viewMode}
                searchTerm={searchTerm}
                expandedLogId={expandedLogId}
                appFilter={appFilter}
                apps={apps}
                liveMode={liveMode}
                onPageChange={setPage}
                onViewModeChange={handleViewModeChange}
                onSearchChange={handleSearchChange}
                onExpandLog={handleExpandLog}
                onViewRaw={handleViewRaw}
                onDeleteLog={handleDeleteLog}
                onBulkDelete={handleBulkDelete}
                onAppFilterChange={handleAppFilterChange}
                onLiveModeToggle={() => setLiveMode((prev) => !prev)}
              >
                {/* Trace content rendered inside the expanded log row */}
                {traceData && (
                  <TraceTimeline traceData={traceData} viewMode={viewMode} />
                )}
              </LogsTable>
            </>
          )}

          {currentView === 'settings' && <SettingsPanel />}
          {currentView === 'apps' && <AppsManager />}
        </div>
      </main>

      {/* Modals & Drawers */}
      <ExportModal open={exportModalOpen} onClose={() => setExportModalOpen(false)} />
      <RawDataDrawer
        open={rawDrawerOpen}
        data={rawLogData}
        onClose={() => { setRawDrawerOpen(false); setRawLogData(null); }}
      />
    </div>
  );
}