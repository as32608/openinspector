import { Activity, Clock, AlertTriangle, Zap } from 'lucide-react';
import type { MetricsSummary } from '../types';

interface MetricsBarProps {
  metrics: MetricsSummary | null;
  errorFilterActive: boolean;
  onToggleErrorFilter: () => void;
}

export default function MetricsBar({ metrics, errorFilterActive, onToggleErrorFilter }: MetricsBarProps) {
  if (!metrics) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass-card p-5">
            <div className="skeleton h-4 w-24 mb-3"></div>
            <div className="skeleton h-7 w-16"></div>
          </div>
        ))}
      </div>
    );
  }

  const cards = [
    {
      label: 'Total Requests',
      value: metrics.total_requests.toLocaleString(),
      icon: Activity,
      color: 'text-accent-blue',
      bgColor: 'bg-accent-blue/10',
      glow: '',
    },
    {
      label: 'Avg Latency',
      value: metrics.avg_latency ? `${metrics.avg_latency.toFixed(2)}s` : '—',
      icon: Clock,
      color: 'text-accent-emerald',
      bgColor: 'bg-accent-emerald/10',
      glow: '',
    },
    {
      label: 'Errors',
      value: metrics.error_count.toLocaleString(),
      icon: AlertTriangle,
      color: 'text-accent-red',
      bgColor: 'bg-accent-red/10',
      glow: errorFilterActive ? 'glow-red pulse-ring' : '',
      clickable: true,
    },
    {
      label: 'Success Rate',
      value: metrics.total_requests > 0
        ? `${(((metrics.total_requests - metrics.error_count) / metrics.total_requests) * 100).toFixed(1)}%`
        : '—',
      icon: Zap,
      color: 'text-accent-amber',
      bgColor: 'bg-accent-amber/10',
      glow: '',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`glass-card p-5 flex items-center space-x-4 transition-all duration-300 ${card.glow} ${
            card.clickable
              ? 'cursor-pointer hover:border-accent-red/30 hover:bg-accent-red/5 group'
              : ''
          } ${errorFilterActive && card.clickable ? 'border-accent-red/40 bg-accent-red/5' : ''}`}
          onClick={card.clickable ? onToggleErrorFilter : undefined}
        >
          <div className={`p-3 rounded-xl ${card.bgColor} transition-transform duration-200 ${card.clickable ? 'group-hover:scale-110' : ''}`}>
            <card.icon className={`w-5 h-5 ${card.color}`} />
          </div>
          <div>
            <p className="text-xs text-text-secondary font-medium uppercase tracking-wider">
              {card.label}
              {card.clickable && (
                <span className="ml-1.5 text-[10px] text-text-muted">
                  {errorFilterActive ? '(filtered)' : '(click to filter)'}
                </span>
              )}
            </p>
            <p className="text-2xl font-bold text-text-primary mt-0.5">{card.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
