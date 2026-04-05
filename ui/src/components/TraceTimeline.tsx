import { MessageSquare, Terminal, BrainCircuit, CornerDownRight, Wrench } from 'lucide-react';
import { motion } from 'framer-motion';
import type { TraceResponse, ViewMode } from '../types';

interface TraceTimelineProps {
  traceData: TraceResponse;
  viewMode: ViewMode;
}

// Robust helper to format tool arguments whether they are strings or objects
function renderArgs(args: any): string {
  if (!args) return "";
  if (typeof args === 'string') {
    try {
      return JSON.stringify(JSON.parse(args));
    } catch {
      return args;
    }
  }
  return JSON.stringify(args);
}

// Recursive helper to handle Anthropic's Array of Content Blocks vs OpenAI's Strings
function renderMessageContent(content: any): React.ReactNode {
  if (!content) return null;

  if (typeof content === 'string') {
    return <div className="whitespace-pre-wrap">{content}</div>;
  }

  if (Array.isArray(content)) {
    return (
      <div className="space-y-2">
        {content.map((block: any, i: number) => {
          if (block.type === 'text') {
            return <div key={i} className="whitespace-pre-wrap">{block.text}</div>;
          }
          if (block.type === 'thinking') {
            return (
              <div key={i} className="text-xs bg-accent-amber/5 p-3 rounded-lg border border-accent-amber/10 text-accent-amber/90">
                <span className="font-bold uppercase block mb-1 text-accent-amber/60 text-[10px]">Thinking Block</span>
                {block.thinking}
              </div>
            );
          }
          if (block.type === 'tool_use') {
            return (
              <div key={i} className="mt-3 space-y-1">
                <span className="text-[10px] uppercase font-bold text-accent-purple/70">Action Invoked:</span>
                <div className="bg-bg-elevated/80 p-2 rounded-lg border border-accent-purple/10 text-xs font-mono">
                  <span className="font-bold text-accent-purple">{block.name}</span>
                  <span className="text-text-muted">({renderArgs(block.input)})</span>
                </div>
              </div>
            );
          }
          if (block.type === 'tool_result') {
            return (
              <div key={i} className="text-xs font-mono bg-accent-amber/5 p-3 rounded-lg border border-accent-amber/10 text-accent-amber/90">
                {renderMessageContent(block.content)}
              </div>
            );
          }
          return null;
        })}
      </div>
    );
  }
  return <pre className="text-xs whitespace-pre-wrap opacity-70">{JSON.stringify(content, null, 2)}</pre>;
}

function renderFinalText(text: string, raw: string) {
  if (text) return <pre className="whitespace-pre-wrap font-sans text-sm">{text}</pre>;
  if (raw && raw.includes('OPENROUTER PROCESSING')) {
    return <span className="text-text-muted italic text-sm">Streaming response completed without final text body.</span>;
  }
  return <pre className="whitespace-pre-wrap text-xs text-text-muted">{raw}</pre>;
}

export default function TraceTimeline({ traceData, viewMode }: TraceTimelineProps) {
  if (!traceData?.chain) return null;

  return (
    <div className="px-8 lg:px-12 py-8 bg-bg-base/50 border-t border-border space-y-10">
      {/* --- Input Context & Tools --- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 border-b border-border pb-8">
        {/* Conversation History */}
        <div className="space-y-3">
          <h3 className="font-semibold text-text-secondary flex items-center text-xs uppercase tracking-wider">
            <MessageSquare className="w-4 h-4 mr-2 text-accent-blue" /> Conversation Context
          </h3>

          {/* Anthropic System Prompt */}
          {traceData.clicked_log?.parsed_req?.system && (
            <div className="p-4 rounded-lg text-sm border bg-bg-elevated/50 border-border text-text-secondary">
              <div className="font-bold text-[10px] opacity-50 uppercase mb-2">System Prompt</div>
              <div>{renderMessageContent(traceData.clicked_log.parsed_req.system)}</div>
            </div>
          )}

          {traceData.clicked_log?.parsed_req?.messages?.map((msg: any, idx: number) => {
            let effectiveRole = msg.role;
            let anthropicToolId = null;

            if (msg.role === 'user' && Array.isArray(msg.content)) {
              const resultBlock = msg.content.find((b: any) => b.type === 'tool_result');
              if (resultBlock) {
                effectiveRole = 'tool';
                anthropicToolId = resultBlock.tool_use_id;
              }
            }

            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03 }}
                className={`p-4 rounded-lg text-sm border ${
                  effectiveRole === 'system' ? 'bg-bg-elevated/50 border-border text-text-secondary' :
                  effectiveRole === 'user' ? 'bg-accent-blue/5 border-accent-blue/10 text-text-primary' :
                  effectiveRole === 'tool' ? 'bg-accent-amber/5 border-accent-amber/10 text-accent-amber/90 font-mono' :
                  'bg-bg-surface border-border text-text-secondary'
                }`}
              >
                <div className="font-bold text-[10px] opacity-50 uppercase mb-2 flex justify-between">
                  <span>{effectiveRole === 'tool' ? 'TOOL RESPONSE' : effectiveRole}</span>
                  {msg.tool_call_id && <span className="font-mono text-text-dim">ID: {msg.tool_call_id}</span>}
                  {anthropicToolId && <span className="font-mono text-text-dim">ID: {anthropicToolId}</span>}
                </div>
                <div>{renderMessageContent(msg.content)}</div>

                {msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <span className="text-[10px] uppercase font-bold text-accent-purple/70">Triggered Tools:</span>
                    {msg.tool_calls.map((tc: any, tIdx: number) => {
                      const tcName = tc.function?.name || tc.name;
                      return (
                        <div key={tIdx} className="bg-bg-elevated/60 p-2 rounded-lg border border-accent-purple/10 text-xs font-mono">
                          <span className="font-bold text-accent-purple">{tcName}</span>
                          <span className="text-text-muted">({renderArgs(tc.function?.arguments || tc.arguments)})</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Provided Tools */}
        {traceData.clicked_log?.parsed_req?.tools?.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-text-secondary flex items-center text-xs uppercase tracking-wider">
              <Terminal className="w-4 h-4 mr-2 text-accent-purple" /> Provided Tools
            </h3>
            <div className="space-y-3">
              {traceData.clicked_log.parsed_req.tools.map((t: any, i: number) => {
                const toolName = t.function?.name || t.name || "Unknown Tool";
                const toolDesc = t.function?.description || t.description || "No description provided.";
                const props = t.function?.parameters?.properties || t.input_schema?.properties || {};
                const reqArgs = t.function?.parameters?.required || t.input_schema?.required || [];

                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex flex-col glass-card overflow-hidden"
                  >
                    <div className="px-4 py-2.5 bg-accent-purple/5 text-left text-sm font-mono text-accent-purple border-b border-border">
                      <Wrench className="w-3.5 h-3.5 inline mr-2 opacity-60" />
                      <span className="font-bold">{toolName}</span>
                    </div>
                    <div className="p-4 text-xs text-text-secondary">
                      <p className="italic text-text-muted mb-4 whitespace-pre-wrap">{toolDesc}</p>
                      {Object.keys(props).length > 0 ? (
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="pb-2 font-semibold text-text-muted w-1/5 text-[11px]">Argument</th>
                              <th className="pb-2 font-semibold text-text-muted w-1/5 text-[11px]">Type</th>
                              <th className="pb-2 font-semibold text-text-muted w-1/12 text-[11px]">Req.</th>
                              <th className="pb-2 font-semibold text-text-muted text-[11px]">Description</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(props).map(([argName, argData]: any) => (
                              <tr key={argName} className="border-b border-border/50 last:border-0 align-top">
                                <td className="py-2 font-mono text-accent-blue pr-2">{argName}</td>
                                <td className="py-2 text-text-muted pr-2">
                                  {argData.type || (argData.anyOf ? 'anyOf' : (argData.enum ? 'enum' : 'any'))}
                                </td>
                                <td className="py-2 pr-2">
                                  {reqArgs.includes(argName) ? <span className="text-accent-red font-bold">Yes</span> : <span className="text-text-dim">No</span>}
                                </td>
                                <td className="py-2 text-text-muted opacity-80 break-words pr-2">
                                  {argData.description || "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="text-text-dim">No arguments expected.</p>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* --- Agent Execution Timeline --- */}
      <div className="space-y-6 pt-2">
        <h3 className="font-semibold text-text-secondary flex items-center text-xs uppercase tracking-wider mb-6">
          <BrainCircuit className="w-4 h-4 mr-2 text-accent-emerald" />
          {viewMode === 'plain' ? 'Current Step Execution' : 'Execution Timeline'}
        </h3>

        {(() => {
          const clickedIndex = traceData.chain.findIndex((s: any) => s.id === traceData.clicked_log_id);
          const displayChain = viewMode === 'plain'
            ? [traceData.chain[clickedIndex]]
            : traceData.chain.slice(clickedIndex);

          if (displayChain.length === 0 || !displayChain[0]) return null;

          return displayChain.map((step: any, index: number) => {
            const hasFinalText = !!step.final_text || (!step.parsed_tools?.length && !!step.response_body_raw);
            const stepLabel = viewMode === 'plain' ? 'Execution' : `Step ${index + 1}`;

            return (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className="relative pl-6 border-l-2 border-accent-blue/20 mb-8 last:mb-0"
              >
                <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-4 border-bg-base ${
                  step.id === traceData.clicked_log_id ? 'bg-accent-blue' : 'bg-accent-blue/40'
                }`} />

                <h4 className="font-bold text-text-primary mb-4 flex items-center flex-wrap gap-2">
                  {stepLabel}
                  <span className="font-mono text-[10px] text-text-muted bg-bg-elevated px-2 py-0.5 rounded">Log #{step.id}</span>
                  <span className="font-mono text-[10px] text-text-muted bg-bg-elevated px-2 py-0.5 rounded">{step.duration_sec?.toFixed(2)}s</span>
                  {step.id === traceData.clicked_log_id && viewMode === 'trace' && (
                    <span className="font-semibold text-[10px] text-accent-blue bg-accent-blue/10 px-2 py-0.5 rounded border border-accent-blue/20">Trace Start</span>
                  )}
                </h4>

                <div className="space-y-3">
                  {/* Thought */}
                  {step.final_reasoning_text && (
                    <div className="bg-accent-amber/5 border border-accent-amber/10 p-4 rounded-lg text-sm text-accent-amber/90">
                      <div className="font-bold text-[10px] uppercase mb-2 text-accent-amber/50">Thought / Reasoning</div>
                      <pre className="whitespace-pre-wrap font-sans">{step.final_reasoning_text}</pre>
                    </div>
                  )}

                  {/* Tool Calls & Results */}
                  {step.parsed_tools?.length > 0 && (
                    <div className="bg-accent-purple/5 border border-accent-purple/10 p-4 rounded-lg text-sm">
                      <div className="font-bold text-[10px] uppercase mb-2 text-accent-purple/60">Tool Calls Invoked</div>
                      {step.parsed_tools.map((tc: any, i: number) => {
                        const actualIndex = traceData.chain.findIndex((s: any) => s.id === step.id);
                        const nextStep = traceData.chain[actualIndex + 1];

                        const toolResultMsg = nextStep?.parsed_req?.messages?.find((m: any) => {
                          if (m.role === 'tool' && m.tool_call_id === tc.id) return true;
                          if (m.role === 'user' && Array.isArray(m.content)) {
                            return m.content.some((b: any) => b.type === 'tool_result' && b.tool_use_id === tc.id);
                          }
                          return false;
                        });

                        let resultToRender = toolResultMsg?.content;
                        if (toolResultMsg?.role === 'user' && Array.isArray(toolResultMsg.content)) {
                          const block = toolResultMsg.content.find((b: any) => b.type === 'tool_result' && b.tool_use_id === tc.id);
                          resultToRender = block ? [block] : null;
                        }

                        return (
                          <div key={i} className="font-mono text-xs bg-bg-surface/60 rounded-lg border border-accent-purple/10 mb-3 last:mb-0 overflow-hidden">
                            <div className="p-3">
                              <span className="font-bold text-accent-purple">{tc.name}</span>
                              ({renderArgs(tc.arguments)})
                              <div className="text-text-dim mt-1 text-[10px]">ID: {tc.id}</div>
                            </div>
                            {resultToRender && (
                              <div className="bg-accent-amber/5 border-t border-accent-purple/5 p-3 text-accent-amber/90 flex items-start">
                                <CornerDownRight className="w-3 h-3 mr-2 mt-0.5 text-accent-amber/50 flex-shrink-0" />
                                <div className="w-full overflow-hidden">
                                  <span className="font-bold text-[10px] uppercase text-accent-amber/60 block mb-1">Tool Result</span>
                                  <div className="whitespace-pre-wrap font-sans text-sm">{renderMessageContent(resultToRender)}</div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Final Response Text */}
                  {hasFinalText && (
                    <div className="bg-bg-surface border border-border p-4 rounded-lg text-sm">
                      <div className="font-bold text-[10px] uppercase mb-2 text-accent-emerald">Response Output</div>
                      <div className="text-text-primary">
                        {renderFinalText(step.final_text, step.response_body_raw)}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          });
        })()}
      </div>
    </div>
  );
}
