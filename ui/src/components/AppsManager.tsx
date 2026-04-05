import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, Star, ExternalLink, Globe, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import { fetchApps, createApp, updateApp, deleteApp } from '../lib/api';
import type { AppConfig } from '../types';

export default function AppsManager() {
  const [apps, setApps] = useState<AppConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  // Form state
  const [formSlug, setFormSlug] = useState('');
  const [formName, setFormName] = useState('');
  const [formTargetUrl, setFormTargetUrl] = useState('');
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [formSaving, setFormSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchApps();
      setApps(res.apps);
    } catch (e) {
      toast.error('Failed to load apps');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setFormSlug('');
    setFormName('');
    setFormTargetUrl('');
    setFormIsDefault(false);
    setShowForm(false);
    setEditingId(null);
  };

  const startEdit = (app: AppConfig) => {
    setFormSlug(app.slug);
    setFormName(app.name);
    setFormTargetUrl(app.target_url);
    setFormIsDefault(app.is_default);
    setEditingId(app.id);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!formSlug || !formName || !formTargetUrl) {
      toast.error('All fields are required');
      return;
    }

    setFormSaving(true);
    try {
      if (editingId) {
        await updateApp(editingId, {
          slug: formSlug,
          name: formName,
          target_url: formTargetUrl,
          is_default: formIsDefault,
        });
        toast.success(`App "${formName}" updated`);
      } else {
        await createApp({
          slug: formSlug,
          name: formName,
          target_url: formTargetUrl,
          is_default: formIsDefault,
        });
        toast.success(`App "${formName}" created`);
      }
      resetForm();
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save app');
    }
    setFormSaving(false);
  };

  const handleDelete = async (app: AppConfig) => {
    if (!confirm(`Delete app "${app.name}"? Existing logs with this app slug will remain.`)) return;
    try {
      await deleteApp(app.id);
      toast.success(`App "${app.name}" deleted`);
      await load();
    } catch (e) {
      toast.error('Failed to delete app');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-text-primary">App Routes</h2>
          <p className="text-sm text-text-muted mt-1">
            Define named routing targets. Each app gets a unique URL prefix: <code className="text-accent-cyan bg-bg-elevated px-1.5 py-0.5 rounded text-[11px]">http://localhost:8080/app-&#123;slug&#125;/...</code>
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center px-4 py-2 text-xs font-semibold rounded-lg bg-accent-blue text-white hover:bg-accent-blue-hover transition-all"
        >
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Add App
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="glass-card p-6 space-y-4 animate-fade-in">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-text-primary">
              {editingId ? 'Edit App' : 'New App'}
            </h3>
            <button onClick={resetForm} className="text-text-muted hover:text-text-secondary transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1.5">
                Display Name
              </label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="My OpenRouter App"
                className="w-full bg-bg-deep border border-border rounded-lg px-4 py-2.5 text-sm text-text-primary placeholder:text-text-dim focus:ring-1 focus:ring-border-focus outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1.5">
                Slug (URL prefix)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-text-dim text-sm">/app-</span>
                <input
                  type="text"
                  value={formSlug}
                  onChange={(e) => setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="openrouter"
                  className="w-full bg-bg-deep border border-border rounded-lg pl-14 pr-4 py-2.5 text-sm font-mono text-text-primary placeholder:text-text-dim focus:ring-1 focus:ring-border-focus outline-none"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1.5">
              Target URL (upstream endpoint)
            </label>
            <input
              type="text"
              value={formTargetUrl}
              onChange={(e) => setFormTargetUrl(e.target.value)}
              placeholder="https://openrouter.ai/api/v1"
              className="w-full bg-bg-deep border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-text-primary placeholder:text-text-dim focus:ring-1 focus:ring-border-focus outline-none"
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={formIsDefault}
                onChange={(e) => setFormIsDefault(e.target.checked)}
                className="w-4 h-4 rounded border-border text-accent-blue focus:ring-accent-blue bg-bg-deep accent-accent-blue"
              />
              <span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors">
                <Star className="w-3.5 h-3.5 inline mr-1 text-accent-amber" />
                Default app (handles requests without <code className="text-accent-cyan text-[11px]">/app-*</code> prefix)
              </span>
            </label>

            <button
              onClick={handleSubmit}
              disabled={formSaving || !formSlug || !formName || !formTargetUrl}
              className="flex items-center px-5 py-2 text-xs font-semibold rounded-lg bg-accent-emerald text-white hover:bg-accent-emerald/80 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <Check className="w-3.5 h-3.5 mr-1.5" />
              {formSaving ? 'Saving...' : editingId ? 'Update' : 'Create'}
            </button>
          </div>

          {/* Preview */}
          {formSlug && formTargetUrl && (
            <div className="glass-card p-4 mt-2">
              <div className="text-[10px] uppercase text-text-dim font-semibold mb-2">Routing Preview</div>
              <div className="font-mono text-xs space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-accent-blue">Client sends to:</span>
                  <span className="text-text-secondary">http://localhost:8080/app-{formSlug}/<span className="text-text-dim">v1/chat/completions</span></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-accent-emerald">Proxy forwards to:</span>
                  <span className="text-text-secondary">{formTargetUrl}/<span className="text-text-dim">v1/chat/completions</span></span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Apps List */}
      <div className="glass-card divide-y divide-border overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="skeleton h-10 w-10 rounded-lg"></div>
                <div className="flex-1">
                  <div className="skeleton h-4 w-40 mb-1"></div>
                  <div className="skeleton h-3 w-64"></div>
                </div>
              </div>
            ))}
          </div>
        ) : apps.length === 0 ? (
          <div className="p-12 text-center">
            <Globe className="w-10 h-10 text-text-dim mx-auto mb-3" />
            <p className="text-text-muted text-sm">No apps configured yet.</p>
            <p className="text-text-dim text-xs mt-1">A default app will be created from your BASE_URL setting on first proxy startup.</p>
          </div>
        ) : (
          apps.map((app) => (
            <div key={app.id} className="p-5 flex items-center justify-between hover:bg-bg-elevated/30 transition-colors group">
              <div className="flex items-center gap-4 min-w-0">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold flex-shrink-0 ${
                  app.is_default
                    ? 'bg-accent-amber/10 text-accent-amber'
                    : 'bg-accent-cyan/10 text-accent-cyan'
                }`}>
                  {app.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text-primary">{app.name}</span>
                    {app.is_default && (
                      <span className="inline-flex items-center text-[10px] font-medium bg-accent-amber/10 text-accent-amber px-1.5 py-0.5 rounded">
                        <Star className="w-2.5 h-2.5 mr-0.5" />
                        Default
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-text-dim bg-bg-elevated px-1.5 py-0.5 rounded">
                      /app-{app.slug}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-1 text-xs text-text-muted font-mono truncate">
                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                    {app.target_url}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => startEdit(app)}
                  className="p-2 rounded-lg text-text-muted hover:text-accent-blue hover:bg-accent-blue/10 transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(app)}
                  className="p-2 rounded-lg text-text-muted hover:text-accent-red hover:bg-accent-red/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Help */}
      <div className="glass-card p-4 text-xs text-text-muted space-y-2">
        <p className="font-medium text-text-secondary">How app routing works</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Each app gets a URL prefix: <code className="text-accent-cyan bg-bg-elevated px-1 py-0.5 rounded">http://localhost:8080/app-&#123;slug&#125;/...</code></li>
          <li>The <code className="text-accent-cyan bg-bg-elevated px-1 py-0.5 rounded">/app-&#123;slug&#125;</code> prefix is stripped before forwarding to the target URL.</li>
          <li>The <strong>default</strong> app handles all traffic that doesn't match any <code className="text-accent-cyan bg-bg-elevated px-1 py-0.5 rounded">/app-*</code> prefix — for backward compatibility.</li>
          <li>Multiple apps can point to the same target URL (e.g., two apps both routing to OpenRouter).</li>
          <li>All logs record the app slug so you can filter by app in the traces view.</li>
        </ul>
      </div>
    </div>
  );
}
