import { useState, useEffect } from 'react';
import { Save, RefreshCw, Info } from 'lucide-react';
import { toast } from 'sonner';
import { fetchSettings, updateSettings } from '../lib/api';
import type { Setting } from '../types';

const SETTING_DESCRIPTIONS: Record<string, string> = {
  BASE_URL: 'Default target URL for proxied requests when no app-specific route matches. This is the fallback endpoint.',
  GLOBAL_TIMEOUT: 'Maximum time (in seconds) before a request is killed. Protects against infinite generation loops with local models.',
  MAX_RETRIES: 'Number of retry attempts when a 429 (rate limit) response is received from the upstream provider.',
  BASE_DELAY: 'Base delay (in seconds) for exponential backoff between retries. Actual delay = BASE_DELAY × 2^attempt.',
};

export default function SettingsPanel() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchSettings();
      setSettings(res.settings);
      const vals: Record<string, string> = {};
      res.settings.forEach(s => { vals[s.key] = s.value; });
      setEditValues(vals);
    } catch (e) {
      toast.error('Failed to load settings');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const hasChanges = settings.some(s => editValues[s.key] !== s.value);

  const handleSave = async () => {
    setSaving(true);
    try {
      const changed: Record<string, string> = {};
      settings.forEach(s => {
        if (editValues[s.key] !== s.value) {
          changed[s.key] = editValues[s.key];
        }
      });
      if (Object.keys(changed).length > 0) {
        await updateSettings(changed);
        toast.success('Settings saved! Changes will take effect within ~5 seconds.');
        await load();
      }
    } catch (e) {
      toast.error('Failed to save settings');
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-text-primary">Settings</h2>
          <p className="text-sm text-text-muted mt-1">
            Configuration is stored in the database and synced with the proxy every ~5 seconds. No restart needed.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={load}
            className="flex items-center px-3 py-2 text-xs font-medium rounded-lg border border-border text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Refresh
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="flex items-center px-4 py-2 text-xs font-semibold rounded-lg bg-accent-blue text-white hover:bg-accent-blue-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <Save className="w-3.5 h-3.5 mr-1.5" />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Settings Form */}
      <div className="glass-card divide-y divide-border">
        {loading ? (
          <div className="p-6 space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i}>
                <div className="skeleton h-4 w-32 mb-2"></div>
                <div className="skeleton h-10 w-full"></div>
              </div>
            ))}
          </div>
        ) : settings.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-sm">
            No settings found. They will be seeded on first proxy startup from the .env file.
          </div>
        ) : (
          settings.map((setting) => (
            <div key={setting.key} className="p-5 hover:bg-bg-elevated/30 transition-colors">
              <div className="flex items-start justify-between gap-8">
                <div className="flex-1 min-w-0">
                  <label className="block text-sm font-semibold text-text-primary font-mono mb-1">
                    {setting.key}
                  </label>
                  {SETTING_DESCRIPTIONS[setting.key] && (
                    <p className="text-xs text-text-muted flex items-start gap-1.5 mb-3">
                      <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-accent-blue/50" />
                      {SETTING_DESCRIPTIONS[setting.key]}
                    </p>
                  )}
                  <input
                    type="text"
                    value={editValues[setting.key] || ''}
                    onChange={(e) => setEditValues({ ...editValues, [setting.key]: e.target.value })}
                    className={`w-full bg-bg-deep border rounded-lg px-4 py-2.5 text-sm font-mono text-text-primary placeholder:text-text-dim focus:ring-1 focus:ring-border-focus focus:border-border-focus outline-none transition-all ${
                      editValues[setting.key] !== setting.value
                        ? 'border-accent-amber/40'
                        : 'border-border'
                    }`}
                  />
                  {editValues[setting.key] !== setting.value && (
                    <p className="text-[10px] text-accent-amber mt-1.5">
                      Changed from: <span className="font-mono">{setting.value}</span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Info banner */}
      <div className="glass-card p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-accent-blue flex-shrink-0 mt-0.5" />
        <div className="text-xs text-text-muted">
          <p className="font-medium text-text-secondary mb-1">How dynamic settings work</p>
          <p>
            On first startup, the proxy seeds these settings from your <code className="text-accent-purple bg-bg-elevated px-1 py-0.5 rounded">.env</code> file.
            After that, the database is the source of truth. The proxy polls for changes every ~5 seconds, so your updates take effect
            almost immediately—no Docker restart needed.
          </p>
        </div>
      </div>
    </div>
  );
}
