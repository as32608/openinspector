import { X, Download, Calendar, CalendarRange } from 'lucide-react';
import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { getExportUrl } from '../lib/api';
import type { ExportRange } from '../types';

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
}

export default function ExportModal({ open, onClose }: ExportModalProps) {
  const [exportRange, setExportRange] = useState<ExportRange>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const triggerExport = () => {
    if (exportRange === 'custom' && (!customStart || !customEnd)) {
      alert("Please select both start and end dates.");
      return;
    }
    const url = getExportUrl(exportRange, customStart, customEnd);
    window.open(url, '_blank');
    onClose();
  };

  const options: { value: ExportRange; label: string; icon?: typeof Calendar }[] = [
    { value: '7d', label: 'Last 7 Days' },
    { value: '30d', label: 'Last 30 Days' },
    { value: 'all', label: 'All Time' },
    { value: 'custom', label: 'Custom Range', icon: CalendarRange },
  ];

  return (
    <Dialog.Root open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/60 z-50"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md"
              >
                <div className="glass-card shadow-2xl p-6">
                  <div className="flex justify-between items-center mb-6">
                    <Dialog.Title className="text-lg font-bold text-text-primary flex items-center">
                      <Calendar className="w-5 h-5 mr-2 text-accent-blue" />
                      Export Dataset
                    </Dialog.Title>
                    <Dialog.Close asChild>
                      <button className="text-text-muted hover:text-text-primary transition-colors">
                        <X className="w-5 h-5" />
                      </button>
                    </Dialog.Close>
                  </div>

                  <div className="space-y-2 mb-6">
                    {options.map((opt) => (
                      <label
                        key={opt.value}
                        className={`block rounded-lg p-3 cursor-pointer transition-all border ${
                          exportRange === opt.value
                            ? 'border-accent-blue/40 bg-accent-blue/5'
                            : 'border-border hover:bg-bg-elevated/40'
                        }`}
                      >
                        <div className="flex items-center">
                          <input
                            type="radio"
                            name="exportRange"
                            value={opt.value}
                            checked={exportRange === opt.value}
                            onChange={() => setExportRange(opt.value)}
                            className="w-4 h-4 text-accent-blue focus:ring-accent-blue bg-bg-deep border-border accent-accent-blue"
                          />
                          <span className="ml-3 text-sm font-medium text-text-primary flex items-center">
                            {opt.icon && <opt.icon className="w-4 h-4 mr-2 text-text-muted" />}
                            {opt.label}
                          </span>
                        </div>
                      </label>
                    ))}

                    {exportRange === 'custom' && (
                      <div className="flex items-center gap-4 pl-8 pt-2">
                        <div className="flex-1">
                          <label className="block text-[10px] text-text-muted mb-1 uppercase">Start Date</label>
                          <input
                            type="date"
                            value={customStart}
                            onChange={(e) => setCustomStart(e.target.value)}
                            className="w-full bg-bg-deep border border-border rounded-lg p-2 text-sm text-text-primary focus:ring-1 focus:ring-border-focus outline-none"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="block text-[10px] text-text-muted mb-1 uppercase">End Date</label>
                          <input
                            type="date"
                            value={customEnd}
                            onChange={(e) => setCustomEnd(e.target.value)}
                            className="w-full bg-bg-deep border border-border rounded-lg p-2 text-sm text-text-primary focus:ring-1 focus:ring-border-focus outline-none"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={triggerExport}
                    disabled={exportRange === 'custom' && (!customStart || !customEnd)}
                    className="w-full flex items-center justify-center font-semibold py-3 px-4 rounded-lg bg-accent-blue text-white hover:bg-accent-blue-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download JSONL
                  </button>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
