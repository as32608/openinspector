import { X, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import type { RawLogData } from '../types';

interface RawDataDrawerProps {
  open: boolean;
  data: RawLogData | null;
  onClose: () => void;
}

function JsonBlock({ label, data }: { label: string; data: any }) {
  const [copied, setCopied] = useState(false);

  if (data === null || data === undefined || data === '') return null;

  const formatted = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(formatted);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">{label}</h4>
        <button
          onClick={handleCopy}
          className="flex items-center text-[10px] text-text-dim hover:text-text-secondary transition-colors px-1.5 py-0.5 rounded hover:bg-bg-elevated"
        >
          {copied ? <Check className="w-3 h-3 mr-1 text-accent-emerald" /> : <Copy className="w-3 h-3 mr-1" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="text-xs font-mono text-text-secondary bg-bg-deep rounded-lg p-4 overflow-x-auto max-h-96 overflow-y-auto border border-border whitespace-pre-wrap break-all">
        {formatted}
      </pre>
    </div>
  );
}

export default function RawDataDrawer({ open, data, onClose }: RawDataDrawerProps) {
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
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                className="fixed top-0 right-0 h-full w-full max-w-2xl z-50 bg-bg-base border-l border-border shadow-2xl flex flex-col"
              >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
                  <div>
                    <Dialog.Title className="text-lg font-bold text-text-primary">Raw Log Data</Dialog.Title>
                    {data && (
                      <p className="text-xs text-text-muted mt-0.5">
                        Log #{data.id} • {data.method} • Status {data.response_status_code} • {data.app_slug}
                      </p>
                    )}
                  </div>
                  <Dialog.Close asChild>
                    <button className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
                      <X className="w-5 h-5" />
                    </button>
                  </Dialog.Close>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-1">
                  {data ? (
                    <>
                      {/* Basic Info */}
                      <div className="grid grid-cols-2 gap-3 mb-6">
                        <div className="glass-card p-3">
                          <div className="text-[10px] uppercase text-text-dim font-semibold mb-1">URL</div>
                          <div className="text-xs text-text-secondary font-mono break-all">{data.url}</div>
                        </div>
                        <div className="glass-card p-3">
                          <div className="text-[10px] uppercase text-text-dim font-semibold mb-1">Timestamp</div>
                          <div className="text-xs text-text-secondary">{new Date(data.created_at).toLocaleString()}</div>
                        </div>
                        <div className="glass-card p-3">
                          <div className="text-[10px] uppercase text-text-dim font-semibold mb-1">Duration</div>
                          <div className="text-xs text-text-secondary font-mono">{data.duration_sec?.toFixed(3)}s</div>
                        </div>
                        <div className="glass-card p-3">
                          <div className="text-[10px] uppercase text-text-dim font-semibold mb-1">Content Type</div>
                          <div className="text-xs text-text-secondary font-mono">{data.request_content_type || '—'}</div>
                        </div>
                      </div>

                      <JsonBlock label="Query Parameters" data={data.query_params} />
                      <JsonBlock label="Request Headers" data={data.request_headers} />
                      <JsonBlock label="Request Body (JSON)" data={data.request_body_json} />
                      <JsonBlock label="Request Body (Raw)" data={data.request_body_raw} />
                      <JsonBlock label="Response Headers" data={data.response_headers} />
                      <JsonBlock label="Response Body (JSON)" data={data.response_body_json} />
                      <JsonBlock label="Response Body (Raw)" data={data.response_body_raw} />
                      <JsonBlock label="Extracted: Final Text" data={data.final_text} />
                      <JsonBlock label="Extracted: Reasoning" data={data.final_reasoning_text} />
                      <JsonBlock label="Extracted: Tool Calls" data={data.tool_calls} />
                    </>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="skeleton h-8 w-32"></div>
                    </div>
                  )}
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
