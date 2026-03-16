import { useEffect, useState } from 'react';
import { Activity, Clock, AlertTriangle, Download, ChevronRight, Box, Search, Wrench, BrainCircuit, MessageSquare, Terminal, ListFilter, X, Calendar, CalendarRange, CornerDownRight } from 'lucide-react';

const API_BASE = 'http://localhost:8081/api';

export default function App() {
  const [metrics, setMetrics] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [totalLogs, setTotalLogs] = useState<number>(0);
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const [traceData, setTraceData] = useState<any>(null);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const [viewMode, setViewMode] = useState<'plain' | 'trace'>('trace');
  
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportRange, setExportRange] = useState<'7d' | '30d' | 'all' | 'custom'>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  
  const PAGE_SIZE = 50;

  useEffect(() => {
    fetch(`${API_BASE}/metrics`).then(res => res.json()).then(setMetrics);
  }, []);

  useEffect(() => {
    fetchLogs();
    setExpandedLogId(null);
  }, [page, searchTerm, viewMode]);

  const fetchLogs = async () => {
    const res = await fetch(`${API_BASE}/logs?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&search=${encodeURIComponent(searchTerm)}&view=${viewMode}`);
    const data = await res.json();
    setLogs(data.logs);
    setTotalLogs(data.total);
  };

  const handleExpand = async (id: number) => {
    if (expandedLogId === id) {
      setExpandedLogId(null);
      setTraceData(null);
      return;
    }
    setExpandedLogId(id);
    const res = await fetch(`${API_BASE}/traces/${id}`);
    const data = await res.json();
    setTraceData(data);
  };

  const triggerExport = () => {
    let url = `${API_BASE}/export/finetune`;
    if (exportRange === 'custom') {
      if (!customStart || !customEnd) {
        alert("Please select both start and end dates.");
        return;
      }
      const start = new Date(customStart).toISOString();
      const end = new Date(customEnd);
      end.setHours(23, 59, 59, 999);
      url += `?start_date=${start}&end_date=${end.toISOString()}`;
    } else if (exportRange !== 'all') {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - (exportRange === '7d' ? 7 : 30));
      url += `?start_date=${start.toISOString()}&end_date=${end.toISOString()}`;
    }
    window.open(url, '_blank');
    setExportModalOpen(false);
  };

  const renderFinalText = (
      text: string,
      raw: string,
      // parsedTools: any[]
    ) => {
    if (text) return <pre className="whitespace-pre-wrap">{text}</pre>;
    if (raw && raw.includes('OPENROUTER PROCESSING')) {
       return <span className="text-gray-400 italic">Streaming response completed without final text body.</span>;
    }
    return <pre className="whitespace-pre-wrap text-xs text-gray-400">{raw}</pre>;
  };

  // Robust helper to format tool arguments whether they are strings or objects
  const renderArgs = (args: any) => {
    if (!args) return "";
    if (typeof args === 'string') {
      try {
        // Handle double-stringified JSON commonly found in older OpenAI SDK logs
        return JSON.stringify(JSON.parse(args));
      } catch {
        return args;
      }
    }
    return JSON.stringify(args);
  };

  // Recursive helper to handle Anthropic's Array of Content Blocks vs OpenAI's Strings
  const renderMessageContent = (content: any) => {
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
                <div key={i} className="text-xs bg-yellow-50 p-2 rounded border border-yellow-100 italic text-yellow-800">
                  <span className="font-bold uppercase block mb-1">Thinking Block</span>
                  {block.thinking}
                </div>
              );
            }
            if (block.type === 'tool_use') {
              return (
                <div key={i} className="text-xs font-mono bg-purple-100/50 p-2 rounded text-purple-800">
                  <Wrench className="w-3 h-3 inline mr-1"/> Action: {block.name}
                </div>
              );
            }
            if (block.type === 'tool_result') {
               return (
                 <div key={i} className="text-xs font-mono bg-orange-50 p-2 rounded text-orange-800">
                    <CornerDownRight className="w-3 h-3 inline mr-1"/> Tool Result: {renderMessageContent(block.content)}
                 </div>
               );
            }
            return null;
          })}
        </div>
      );
    }
    return <pre className="text-xs whitespace-pre-wrap opacity-70">{JSON.stringify(content, null, 2)}</pre>;
  };


  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans p-8 w-full flex justify-center">
      
      {/* Export Modal Overlay */}
      {exportModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold flex items-center"><Calendar className="w-5 h-5 mr-2" /> Export Dataset</h2>
              <button onClick={() => setExportModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="space-y-3 mb-8">
              <label className={`block border rounded-lg p-3 cursor-pointer transition ${exportRange === '7d' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <div className="flex items-center">
                  <input type="radio" name="exportRange" value="7d" checked={exportRange === '7d'} onChange={() => setExportRange('7d')} className="w-4 h-4 text-blue-600 focus:ring-blue-500" />
                  <span className="ml-3 font-medium">Last 7 Days</span>
                </div>
              </label>
              <label className={`block border rounded-lg p-3 cursor-pointer transition ${exportRange === '30d' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <div className="flex items-center">
                  <input type="radio" name="exportRange" value="30d" checked={exportRange === '30d'} onChange={() => setExportRange('30d')} className="w-4 h-4 text-blue-600 focus:ring-blue-500" />
                  <span className="ml-3 font-medium">Last 30 Days</span>
                </div>
              </label>
              <label className={`block border rounded-lg p-3 cursor-pointer transition ${exportRange === 'all' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <div className="flex items-center">
                  <input type="radio" name="exportRange" value="all" checked={exportRange === 'all'} onChange={() => setExportRange('all')} className="w-4 h-4 text-blue-600 focus:ring-blue-500" />
                  <span className="ml-3 font-medium">All Time</span>
                </div>
              </label>
              
              <label className={`block border rounded-lg p-3 cursor-pointer transition ${exportRange === 'custom' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <div className="flex items-center">
                  <input type="radio" name="exportRange" value="custom" checked={exportRange === 'custom'} onChange={() => setExportRange('custom')} className="w-4 h-4 text-blue-600 focus:ring-blue-500" />
                  <span className="ml-3 font-medium flex items-center"><CalendarRange className="w-4 h-4 mr-2 text-gray-500"/> Custom Range</span>
                </div>
              </label>

              {exportRange === 'custom' && (
                <div className="flex items-center space-x-4 pl-8 pt-2">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Start Date</label>
                    <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">End Date</label>
                    <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                </div>
              )}
            </div>

            <button 
              onClick={triggerExport} 
              style={{ backgroundColor: '#2563eb', color: '#ffffff' }}
              className="w-full font-semibold py-3 px-4 rounded-lg transition flex justify-center items-center shadow-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={exportRange === 'custom' && (!customStart || !customEnd)}
            >
              <Download className="w-4 h-4 mr-2" /> Download JSONL
            </button>
          </div>
        </div>
      )}

      {/* Main Container */}
      <div className="max-w-7xl mx-auto space-y-8 w-full">
        
        {/* Header */}
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <Box className="w-8 h-8 text-blue-600" />
            <h1 className="text-3xl font-bold">Open Inspector</h1>
          </div>
          <button 
            onClick={() => setExportModalOpen(true)} 
            style={{ backgroundColor: '#2563eb', color: '#ffffff' }}
            className="flex items-center space-x-2 font-medium px-4 py-2 rounded-lg transition shadow-md hover:opacity-90"
          >
            <Download className="w-4 h-4" />
            <span>Export Fine-Tuning JSONL</span>
          </button>
        </div>

        {/* Metrics Cards */}
        {metrics && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-4">
              <div className="p-3 bg-blue-50 text-blue-600 rounded-lg"><Activity /></div>
              <div>
                <p className="text-sm text-gray-500 font-medium">Total Requests</p>
                <p className="text-2xl font-bold">{metrics.summary.total_requests}</p>
              </div>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-4">
              <div className="p-3 bg-green-50 text-green-600 rounded-lg"><Clock /></div>
              <div>
                <p className="text-sm text-gray-500 font-medium">Avg Latency</p>
                <p className="text-2xl font-bold">{metrics.summary.avg_latency?.toFixed(2)}s</p>
              </div>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-4">
              <div className="p-3 bg-red-50 text-red-600 rounded-lg"><AlertTriangle /></div>
              <div>
                <p className="text-sm text-gray-500 font-medium">Errors</p>
                <p className="text-2xl font-bold">{metrics.summary.error_count}</p>
              </div>
            </div>
          </div>
        )}

        {/* Filters & Table Header */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex flex-col lg:flex-row justify-between items-center gap-4">
            
            {/* View Toggles */}
            <div className="flex items-center bg-gray-200/50 p-1 rounded-lg">
              <button 
                onClick={() => { setPage(0); setViewMode('trace'); }}
                className={`flex items-center px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${viewMode === 'trace' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <ListFilter className="w-4 h-4 mr-2" />
                Traces (Parents Only)
              </button>
              <button 
                onClick={() => { setPage(0); setViewMode('plain'); }}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${viewMode === 'plain' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
              >
                All Requests (Plain)
              </button>
            </div>

            <div className="flex items-center space-x-4 w-full md:w-auto">
              <div className="relative w-full md:w-64">
                <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
                <input 
                  type="text" 
                  placeholder="Search traces..." 
                  className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); setPage(0); }}
                />
              </div>
              <div className="flex items-center space-x-3">
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  Showing {totalLogs === 0 ? 0 : page * PAGE_SIZE + 1} to {Math.min((page + 1) * PAGE_SIZE, totalLogs)} of {totalLogs}
                </span>
                <div className="flex space-x-1">
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-2 py-1 border border-gray-200 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50">Prev</button>
                  <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= totalLogs} className="px-2 py-1 border border-gray-200 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50">Next</button>
                </div>
              </div>
            </div>
          </div>

          {/* Logs List */}
          <div className="divide-y divide-gray-100">
            {logs.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">No requests found for this filter.</div>
            ) : logs.map((log) => (
              <div key={log.id} className="flex flex-col">
                <div 
                  className="px-6 py-4 flex items-center justify-between hover:bg-blue-50/50 cursor-pointer transition"
                  onClick={() => handleExpand(log.id)}
                >
                  <div className="flex items-center space-x-4 w-1/4">
                    <ChevronRight className={`w-5 h-5 text-gray-400 transform transition-transform ${expandedLogId === log.id ? 'rotate-90' : ''}`} />
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${log.response_status_code === 200 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {log.response_status_code}
                    </span>
                    <span className="text-sm text-gray-500">{new Date(log.created_at).toLocaleTimeString()}</span>
                  </div>
                  
                  {/* Summary Preview */}
                  <div className="w-2/4 text-sm truncate pr-4 text-gray-700">
                    {log.parsed_tools.length > 0 
                      ? <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-xs mr-2 flex-inline items-center"><Wrench className="w-3 h-3 inline mr-1"/>{log.parsed_tools.map((t:any)=>t.name).join(', ')}</span> 
                      : null}
                    {log.final_text || (log.request_body?.messages?.slice(-1)[0]?.content) || 'Streaming Session'}
                  </div>
                  
                  <div className="w-1/4 text-right flex justify-end space-x-4 text-sm text-gray-500">
                     <span className="font-mono bg-gray-100 px-2 py-1 rounded">{log.request_body?.model || 'unknown-model'}</span>
                     <span className="font-mono w-16 text-right">{log.duration_sec?.toFixed(2)}s</span>
                  </div>
                </div>

                {/* Expanded Trace Details */}
                {expandedLogId === log.id && traceData?.chain && (
                  <div className="px-12 py-8 bg-slate-50 border-t border-gray-100 space-y-10">
                    
                    {/* --- Input Context & Tools --- */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 border-b border-gray-200 pb-8">
                      {/* Conversation History (Pulled from the CLICKED log to maintain context accuracy) */}
                      <div className="space-y-3">
                        <h3 className="font-semibold text-gray-700 flex items-center text-sm uppercase tracking-wide"><MessageSquare className="w-4 h-4 mr-2"/> Conversation Context</h3>
                        {traceData.clicked_log?.parsed_req?.messages?.map((msg: any, idx: number) => (
                          <div key={idx} className={`p-4 rounded-lg text-sm border ${
                            msg.role === 'system' ? 'bg-gray-100 border-gray-200 text-gray-700' : 
                            msg.role === 'user' ? 'bg-blue-50 border-blue-100 text-blue-900' : 
                            msg.role === 'tool' ? 'bg-orange-50 border-orange-100 text-orange-900 font-mono' :
                            'bg-white border-gray-200 text-gray-800'
                          }`}>
                            <div className="font-bold text-xs opacity-50 uppercase mb-1 flex justify-between">
                              <span>{msg.role === 'tool' ? 'TOOL RESPONSE' : msg.role}</span>
                              {msg.tool_call_id && <span>ID: {msg.tool_call_id}</span>}
                            </div>
                            
                            {/* Uses new helper to render Anthropic blocks or OpenAI strings seamlessly */}
                            <div>{renderMessageContent(msg.content)}</div>

                            {/* Historical Tool Calls triggered by Assistant */}
                            {msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0 && (
                              <div className="mt-3 space-y-2">
                                <span className="text-xs uppercase font-bold text-purple-600 opacity-70">Triggered Tools:</span>
                                {msg.tool_calls.map((tc:any, tIdx:number) => {
                                  const tcName = tc.function?.name || tc.name;
                                  return (
                                    <div key={tIdx} className="bg-white/60 p-2 rounded border border-gray-200 text-xs font-mono shadow-sm">
                                      <span className="font-bold text-purple-700">{tcName}</span>
                                      {/* Uses new renderArgs to safely print JSON objects or strings */}
                                      <span className="text-gray-600">({renderArgs(tc.function?.arguments || tc.arguments)})</span>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Provided Tools (Pulled from the CLICKED log, always expanded) */}
                      {traceData.clicked_log?.parsed_req?.tools?.length > 0 && (
                        <div className="space-y-3">
                          <h3 className="font-semibold text-gray-700 flex items-center text-sm uppercase tracking-wide"><Terminal className="w-4 h-4 mr-2"/> Provided Tools</h3>
                          <div className="space-y-3">
                             {traceData.clicked_log.parsed_req.tools.map((t:any, i:number) => {
                               // Fallback logic to handle both OpenAI and Anthropic tool schemas
                               const toolName = t.function?.name || t.name || "Unknown Tool";
                               const toolDesc = t.function?.description || t.description || "No description provided.";
                               const props = t.function?.parameters?.properties || t.input_schema?.properties || {};
                               const reqArgs = t.function?.parameters?.required || t.input_schema?.required || [];
                               
                               return (
                                 <div key={i} className="flex flex-col bg-white border border-purple-100 rounded-md shadow-sm overflow-hidden">
                                   <div className="px-4 py-2 bg-purple-50 text-left text-sm font-mono text-purple-800 border-b border-purple-100">
                                     <span className="font-bold">{toolName}</span>
                                   </div>
                                   
                                   <div className="p-4 text-xs text-gray-700">
                                     <p className="italic text-gray-600 mb-4 whitespace-pre-wrap">{toolDesc}</p>
                                     
                                     {Object.keys(props).length > 0 ? (
                                       <table className="w-full text-left border-collapse">
                                         <thead>
                                           <tr className="border-b border-gray-200">
                                             <th className="pb-2 font-semibold text-gray-600 w-1/5">Argument</th>
                                             <th className="pb-2 font-semibold text-gray-600 w-1/5">Type</th>
                                             <th className="pb-2 font-semibold text-gray-600 w-1/12">Req.</th>
                                             <th className="pb-2 font-semibold text-gray-600">Description</th>
                                           </tr>
                                         </thead>
                                         <tbody>
                                           {Object.entries(props).map(([argName, argData]: any) => (
                                             <tr key={argName} className="border-b border-gray-100 last:border-0 align-top">
                                               <td className="py-2 font-mono text-blue-600 pr-2">{argName}</td>
                                               <td className="py-2 text-gray-500 pr-2">
                                                 {argData.type || (argData.anyOf ? 'anyOf' : (argData.enum ? 'enum' : 'any'))}
                                               </td>
                                               <td className="py-2 pr-2">
                                                 {reqArgs.includes(argName) ? <span className="text-red-500 font-bold">Yes</span> : 'No'}
                                               </td>
                                               <td className="py-2 text-gray-500 opacity-80 break-words pr-2">
                                                 {argData.description || "-"}
                                               </td>
                                             </tr>
                                           ))}
                                         </tbody>
                                       </table>
                                     ) : (
                                       <p className="text-gray-400">No arguments expected.</p>
                                     )}
                                   </div>
                                 </div>
                               );
                             })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* --- Agent Execution Timeline --- */}
                    <div className="space-y-6 pt-2">
                      <h3 className="font-semibold text-gray-700 flex items-center text-sm uppercase tracking-wide mb-6">
                        <BrainCircuit className="w-4 h-4 mr-2"/> 
                        {viewMode === 'plain' ? 'Agent Execution Timeline (Up to current step)' : 'Full Agent Timeline'}
                      </h3>
                      
                      {(() => {
                        // Truncate the chain array if we are in "Plain" view
                        const clickedIndex = traceData.chain.findIndex((s: any) => s.id === traceData.clicked_log_id);
                        const displayChain = viewMode === 'plain' ? traceData.chain.slice(0, clickedIndex + 1) : traceData.chain;

                        return displayChain.map((step: any, index: number) => {
                          // Logic to hide empty final text box if it's purely a tool execution step
                          const hasFinalText = !!step.final_text || (!step.parsed_tools?.length && !!step.response_body_raw);
                          
                          return (
                            <div key={step.id} className="relative pl-6 border-l-2 border-blue-200 mb-8 last:mb-0">
                              {/* Timeline dot */}
                              <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-4 border-slate-50 ${step.id === traceData.clicked_log_id ? 'bg-blue-600' : 'bg-blue-300'}`}></div>
                              
                              <h4 className="font-bold text-gray-700 mb-4 flex items-center">
                                Step {index + 1} 
                                <span className="ml-3 font-mono text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded shadow-sm">Log ID: {step.id}</span>
                                <span className="ml-3 font-mono text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded shadow-sm">{step.duration_sec?.toFixed(2)}s</span>
                                
                                {/* Visual Indicator for the log the user actually clicked */}
                                {step.id === traceData.clicked_log_id && (
                                  <span className="ml-3 font-semibold text-xs text-blue-700 bg-blue-100 px-2 py-0.5 rounded shadow-sm border border-blue-200">Current View</span>
                                )}
                              </h4>
                              
                              <div className="space-y-3">
                                {/* Thought */}
                                {step.final_reasoning_text && (
                                  <div className="bg-yellow-50/50 border border-yellow-100 p-4 rounded-lg text-sm text-yellow-900 shadow-sm">
                                    <div className="font-bold text-xs uppercase mb-2 opacity-60">Thought / Reasoning</div>
                                    <pre className="whitespace-pre-wrap font-sans">{step.final_reasoning_text}</pre>
                                  </div>
                                )}

                                {/* Tool Calls (Action) and their specific results */}
                                {step.parsed_tools?.length > 0 && (
                                  <div className="bg-purple-50/50 border border-purple-100 p-4 rounded-lg text-sm shadow-sm">
                                     <div className="font-bold text-xs uppercase mb-2 opacity-60 text-purple-900">Tool Calls Invoked</div>
                                     {step.parsed_tools.map((tc:any, i:number) => {
                                       // Look ahead in the full traceData.chain to see if the tool result was captured in the next request
                                       // We use traceData.chain (not displayChain) so the result shows even if the next LLM step is hidden in plain view.
                                       const nextStep = traceData.chain[index + 1];
                                       const toolResultMsg = nextStep?.parsed_req?.messages?.find((m: any) => m.role === 'tool' && m.tool_call_id === tc.id);

                                       return (
                                         <div key={i} className="font-mono text-xs bg-white rounded border border-purple-100 mb-3 last:mb-0 shadow-sm overflow-hidden">
                                           <div className="p-3">
                                             <span className="font-bold text-purple-700">{tc.name}</span>
                                             {/* Fixed argument rendering here */}
                                             ({renderArgs(tc.arguments)})
                                             <div className="text-gray-400 mt-1 text-[10px]">ID: {tc.id}</div>
                                           </div>
                                           
                                           {toolResultMsg && (
                                              <div className="bg-orange-50/80 border-t border-purple-50 p-3 text-orange-900 flex items-start">
                                                <CornerDownRight className="w-3 h-3 mr-2 mt-0.5 text-orange-400 flex-shrink-0" />
                                                <div>
                                                  <span className="font-bold text-[10px] uppercase text-orange-600 block mb-1">Tool Result</span>
                                                  {/* Fixed content block parsing here */}
                                                  <div className="whitespace-pre-wrap font-sans text-sm">{renderMessageContent(toolResultMsg.content)}</div>
                                                </div>
                                              </div>
                                           )}
                                         </div>
                                       )
                                     })}
                                  </div>
                                )}

                                {/* Final Response Text - Conditionally rendered to avoid empty boxes */}
                                {hasFinalText && (
                                  <div className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm shadow-md">
                                    <div className="font-bold text-xs uppercase mb-2 text-green-400">Response output</div>
                                    {renderFinalText(
                                      step.final_text,
                                      step.response_body_raw,
                                      // step.parsed_tools
                                      )}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>

                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}