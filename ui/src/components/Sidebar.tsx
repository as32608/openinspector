import { Activity, Settings, AppWindow, X, ChevronLeft, Telescope } from 'lucide-react';
import type { PageView } from '../types';

interface SidebarProps {
  currentView: PageView;
  onNavigate: (view: PageView) => void;
  collapsed: boolean;
  onToggle: () => void;
}

const navItems: { id: PageView; label: string; icon: typeof Activity }[] = [
  { id: 'logs', label: 'Traces & Logs', icon: Activity },
  { id: 'apps', label: 'App Routes', icon: AppWindow },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function Sidebar({ currentView, onNavigate, collapsed, onToggle }: SidebarProps) {
  return (
    <>
      {/* Mobile overlay */}
      {!collapsed && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onToggle}
        />
      )}

      <aside
        className={`fixed top-0 left-0 h-full z-50 flex flex-col transition-all duration-300 ease-out
          ${collapsed ? '-translate-x-full lg:translate-x-0 lg:w-16' : 'w-64 translate-x-0'}
          bg-bg-base border-r border-border`}
      >
        {/* Logo */}
        <div className={`flex items-center h-16 px-4 border-b border-border ${collapsed ? 'lg:justify-center' : 'justify-between'}`}>
          <div className={`flex items-center space-x-2.5 ${collapsed ? 'lg:hidden' : ''}`}>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-blue to-accent-purple flex items-center justify-center">
              <Telescope className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-text-primary leading-none">OpenInspector</h1>
              <p className="text-[10px] text-text-muted mt-0.5">LLM Observability</p>
            </div>
          </div>

          {/* Collapsed logo */}
          <div className={`items-center justify-center ${collapsed ? 'hidden lg:flex' : 'hidden'}`}>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-blue to-accent-purple flex items-center justify-center">
              <Telescope className="w-4.5 h-4.5 text-white" />
            </div>
          </div>

          <button
            onClick={onToggle}
            className={`p-1.5 rounded-md hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-colors ${collapsed ? 'hidden' : ''}`}
          >
            {collapsed ? <ChevronLeft className="w-4 h-4 rotate-180" /> : <X className="w-4 h-4 lg:hidden" />}
            <ChevronLeft className={`w-4 h-4 hidden lg:block ${collapsed ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-2 space-y-1">
          {navItems.map(item => {
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onNavigate(item.id);
                  if (window.innerWidth < 1024) onToggle();
                }}
                className={`w-full flex items-center rounded-lg transition-all duration-200 group relative
                  ${collapsed ? 'lg:justify-center lg:px-0 px-3 py-2.5' : 'px-3 py-2.5'}
                  ${isActive
                    ? 'bg-accent-blue/10 text-accent-blue sidebar-active'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                  }`}
              >
                <item.icon className={`w-[18px] h-[18px] flex-shrink-0 ${isActive ? 'text-accent-blue' : ''}`} />
                <span className={`ml-3 text-sm font-medium ${collapsed ? 'lg:hidden' : ''}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div className={`p-4 border-t border-border ${collapsed ? 'lg:hidden' : ''}`}>
          <div className="text-[10px] text-text-dim">
            Open Source • Local-first
          </div>
        </div>
      </aside>
    </>
  );
}
