// --- imports ---
import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { prism as lightTheme } from "react-syntax-highlighter/dist/esm/styles/prism";
import { invoke } from "@tauri-apps/api/core";

interface TraceEvent {
  event: string;
  filename?: string;
  function?: string;
  line?: number;
  locals?: Record<string, any>;
  globals?: Record<string, any>;
  value?: any;
  result?: any;
  error?: string;
  traceback?: string;
}

interface FunctionData {
  body: string;
  start_line: number;
  file_path: string;
}

interface FlowPanelProps {
  parents: string[];
  functions: Record<string, FunctionData>;
  expanded: Record<string, boolean>;
  toggle: (id: string) => void;
  onFunctionClick?: (fullId: string) => void;
}

// -------------------------------------------
// syntax highlighting memoization
// -------------------------------------------

const MemoizedLine: React.FC<{ code: string }> = React.memo(
  ({ code }) => (
    <SyntaxHighlighter
      language="python"
      style={lightTheme}
      PreTag="div"
      customStyle={{
        margin: 0,
        padding: 0,
        background: "transparent",
        display: "inline",
        fontFamily: "Jetbrains Mono, monospace",
        fontSize: 16,
        lineHeight: "1.4",
        fontWeight: 500,
        whiteSpace: "pre-wrap",
      }}
      codeTagProps={{ style: { whiteSpace: "pre-wrap", display: "inline" } }}
    >
      {code}
    </SyntaxHighlighter>
  ),
  (prev, next) => prev.code === next.code
);

function stripQualifiedCalls(line: string): string {
  return line.replace(/[A-Za-z0-9_\/\.\-]+\.py::([A-Za-z_]\w*)\s*\(/g, (_, fn) => fn + "(");
}

// Extract arguments from a function call line
//
// This implementation is not robust or fully correct for all valid Python argument syntax.
// It works for very simple cases: ints, quoted strings, basic variable names, and assignment syntax.
// It does not handle things like lists, dicts, nested function calls, unquoted values with spaces or brackets, or Python's keyword-only unpacking (**kwargs, *args), etc.
//
// For true correctness, you'd need a real Python parser (or at least an AST).
//
// The naive implementation below will incorrectly split or misparse in edge cases, but
// for most log lines with very basic calls it will produce semi-useful output.

function extractCallArgs(line: string, targetFnName?: string): { args: any[]; kwargs: Record<string, any> } | null {
  // Match function call pattern: function_name(...) or /path/to/file.py::function_name(...)
  // If targetFnName is provided, only extract args for that specific function
  const pattern = targetFnName 
    ? new RegExp(`(?:[A-Za-z0-9_\\/\\.\\-]+\\.py::)?${targetFnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\((.*)\\)`)
    : /([A-Za-z0-9_\/\.\-]+\.py::)?([A-Za-z_]\w*)\s*\((.*)\)/;
  
  const callMatch = line.match(pattern);
  if (!callMatch) return null;
  
  // Get args string - for targetFnName pattern, it's group 1; for general pattern, it's group 3
  const argsStr = (targetFnName ? callMatch[1] : callMatch[3])?.trim();
  if (!argsStr) return { args: [], kwargs: {} };

  // Attempt to split arguments on commas that are not inside parens or string literals.
  const args: any[] = [];
  const kwargs: Record<string, any> = {};

  let parts: string[] = [];
  let depth = 0;
  let inString: false | '"' | "'" = false;
  let cur = "";

  for (let i = 0; i < argsStr.length; i++) {
    const char = argsStr[i];
    if (!inString && (char === '"' || char === "'")) {
      inString = char;
      cur += char;
    } else if (inString && char === inString && argsStr[i - 1] !== '\\') {
      inString = false;
      cur += char;
    } else if (!inString && char === "(") {
      depth++;
      cur += char;
    } else if (!inString && char === ")") {
      depth = Math.max(0, depth - 1); // don't let negative, avoid parser falling over
      cur += char;
    } else if (!inString && depth === 0 && char === ",") {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += char;
    }
  }
  if (cur.trim().length) parts.push(cur.trim());

  for (const part of parts) {
    if (!part) continue;
    // Try key-value assignment, only supports "name = value"
    const kwMatch = part.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
    if (kwMatch) {
      const key = kwMatch[1];
      const value = kwMatch[2].trim();

      // Handle literals: quoted string, or number
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        kwargs[key] = value.slice(1, -1);
      } else if (!isNaN(Number(value))) {
        kwargs[key] = Number(value);
      } else {
        // variable names, expressions, or anything else becomes string (could be wrong)
        kwargs[key] = value;
      }
    } else {
      const arg = part.trim();
      if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
        args.push(arg.slice(1, -1));
      } else if (!isNaN(Number(arg))) {
        args.push(Number(arg));
      } else {
        args.push(arg);
      }
    }
  }

  // Note: could log extraction problems here if needed
  // console.log(`Extracted arguments: ${JSON.stringify(args)}, ${JSON.stringify(kwargs)}`);
  return { args, kwargs };
}

// Try to resolve variable names to values using locals from the trace event
async function resolveCallArgs(
  callArgs: { args: any[]; kwargs: Record<string, any> } | undefined | null,
  locals?: Record<string, any>,
  functionFullId?: string
): Promise<{ args: any[]; kwargs: Record<string, any> } | null> {
  if (!callArgs) return null;
  const isIdentifier = (v: any) => typeof v === "string" && /^[A-Za-z_]\w*$/.test(v);

  // Resolve positional args
  const resolvedArgs = (callArgs.args || []).map((arg) => {
    if (isIdentifier(arg) && locals && Object.prototype.hasOwnProperty.call(locals, arg)) {
      return locals[arg];
    }
    return arg;
  });

  // Resolve kwargs
  const resolvedKwargs: Record<string, any> = {};
  Object.entries(callArgs.kwargs || {}).forEach(([k, v]) => {
    if (isIdentifier(v) && locals && Object.prototype.hasOwnProperty.call(locals, v as any)) {
      resolvedKwargs[k] = locals[v as any];
    } else {
      resolvedKwargs[k] = v;
    }
  });

  // If function signature is provided, match args to signature
  // ALWAYS filter by signature if we have it - this prevents passing unexpected kwargs
  if (functionFullId) {
    try {
      console.log(`[resolveCallArgs] Getting signature for: ${functionFullId}`);
      const signature = await invoke<{ params?: string[]; error?: string }>("get_function_signature", { 
        entryFullId: functionFullId 
      });
      
      if (signature.error) {
        console.warn(`[resolveCallArgs] Failed to get signature for ${functionFullId}:`, signature.error);
        // If we can't get signature, return empty to avoid passing wrong args
        return { args: [], kwargs: {} };
      }
      
      if (signature.params && Array.isArray(signature.params)) {
        // Match args to function parameters - only include parameters the function accepts
        const matchedKwargs: Record<string, any> = {};
        const paramSet = new Set(signature.params); // For faster lookup
        
        console.log(`[resolveCallArgs] Function ${functionFullId} accepts params:`, signature.params);
        console.log(`[resolveCallArgs] Resolved args:`, resolvedArgs);
        console.log(`[resolveCallArgs] Resolved kwargs:`, resolvedKwargs);
        
        // First, map positional args to parameter names by position
        signature.params.forEach((paramName, index) => {
          if (index < resolvedArgs.length) {
            // Positional arg at this index maps to this parameter
            matchedKwargs[paramName] = resolvedArgs[index];
            console.log(`[resolveCallArgs] Mapped positional arg[${index}] to param '${paramName}':`, resolvedArgs[index]);
          }
        });
        
        // Then, add kwargs that match function parameters (overriding positional if same param)
        // IMPORTANT: Only include kwargs whose KEY matches a parameter name
        Object.entries(resolvedKwargs).forEach(([key, value]) => {
          if (paramSet.has(key)) {
            // Only include if this parameter name is in the function signature
            matchedKwargs[key] = value;
            console.log(`[resolveCallArgs] Included kwarg '${key}' =`, value);
          } else {
            console.log(`[resolveCallArgs] Excluded kwarg '${key}' (not in function signature)`);
          }
        });
        
        console.log(`[resolveCallArgs] Final matched kwargs:`, matchedKwargs);
        
        // Return only the parameters that the function accepts, in the correct order
        // All args are passed as kwargs to match Python's calling convention
        return { args: [], kwargs: matchedKwargs };
      } else {
        // Signature params not available - return empty to avoid passing wrong args
        console.warn(`[resolveCallArgs] Signature params not available for ${functionFullId}`);
        return { args: [], kwargs: {} };
      }
    } catch (err) {
      console.error(`[resolveCallArgs] Error getting function signature for ${functionFullId}:`, err);
      // If signature lookup fails, return empty to avoid passing wrong args
      return { args: [], kwargs: {} };
    }
  }

  // If no functionFullId provided, return resolved args as-is (but this shouldn't happen for function calls)
  console.warn(`[resolveCallArgs] No functionFullId provided, returning resolved args without signature filtering`);
  return { args: resolvedArgs, kwargs: resolvedKwargs };
}

// -------------------------------------------
// main component
// -------------------------------------------

const FlowPanel: React.FC<FlowPanelProps> = ({
  parents,
  functions,
  expanded,
  toggle,
  onFunctionClick,
}) => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  // Store resolved arguments for each function call (by ID)
  const [resolvedCallArgs, setResolvedCallArgs] = useState<Record<string, { args: any[]; kwargs: Record<string, any> }>>({});
  // Store parent function events for function calls (by function call ID) - used to resolve args later
  const [parentFunctionEvents, setParentFunctionEvents] = useState<Record<string, TraceEvent>>({});
  // Store extracted (unresolved) args for function calls (by function call ID) - extracted from the call line
  const [extractedCallArgs, setExtractedCallArgs] = useState<Record<string, { args: any[]; kwargs: Record<string, any> } | null>>({});

  // -------------------------------------------
  // unified click handler for ALL line types
  // -------------------------------------------
    //
  const getEntryFullId = (prefixId: string) => {
    return prefixId.split("-")[0];
};

  const handleLineClick = useCallback(
    async ({
      id,
      filename,
      line,
      fnName,
      entryFullId,
      callArgs,
    }: {
      id: string;
      filename: string;
      line: number;
      fnName?: string; // only present for function-call lines
      entryFullId?: string; // override entry_full_id (for expanded functions)
      callArgs?: { args: any[]; kwargs: Record<string, any> }; // arguments from function call
    }) => {
      toggle(id);
      setActiveId(id);

      if (fnName) onFunctionClick?.(fnName);

      try {
        // Use provided entryFullId or extract from id
        const effectiveEntryFullId = entryFullId || getEntryFullId(id);
        
        // Check if we already have events for this line - if so, don't call tracer again
        // This prevents re-executing the function when going back to a previously traced line
        const existingEvent = traceEvents.find(e => {
          // Match by line number
          if (e.line !== line) return false;
          
          // Match by filename
          if (e.filename && filename) {
            const eFile = e.filename.replace(/\\/g, '/');
            const targetFile = filename.replace(/\\/g, '/');
            if (eFile !== targetFile && 
                !targetFile.endsWith(eFile) && 
                !eFile.endsWith(targetFile)) {
              return false;
            }
          } else if (e.filename !== filename) {
            return false;
          }
          
          // Match by function/entry_full_id
          // If we have an entry_full_id, check if the event's function matches
          if (effectiveEntryFullId && e.function) {
            // Extract function name from entry_full_id (format: "path/to/file.py::function_name")
            const entryFnName = effectiveEntryFullId.split("::").pop();
            if (entryFnName && e.function !== entryFnName) {
              return false;
            }
          }
          
          return true;
        });
        
        if (existingEvent) {
          console.log(`[Line ${line}] Using existing event, skipping tracer call`);
          // If this is a function call and we don't have the parent event stored yet, store it
          if (fnName && existingEvent.locals && !parentFunctionEvents[id]) {
            setParentFunctionEvents((prev) => ({ ...prev, [id]: existingEvent }));
            console.log(`[Function Call] Stored parent function event from existing event for ${fnName} at line ${line}`);
          }
          return; // Don't call tracer, we already have the event
        }
        
        // Use provided callArgs or default
        let effectiveArgs = callArgs || {
          args: [],
          kwargs: { metric_name: "test", period: "last_7_days" },
        };

        // Trace the line (treat function calls as normal lines)
        const traceReq = {
          entry_full_id: effectiveEntryFullId,
          stop_line: line + 1,
          args_json: JSON.stringify(effectiveArgs),
          filename,
        };
        console.log(`Trace request ${JSON.stringify(traceReq)}, entryFullId: ${effectiveEntryFullId}`);
        let event: TraceEvent;
        try {
          event = await invoke<TraceEvent>("get_tracer_data", { req: traceReq });
          event.line = line;
        } catch (err: any) {
          // If the invoke fails (e.g., timeout, process died), create an error event
          console.error("Error calling tracer:", err);
          event = {
            event: "error",
            error: err?.toString() || "Failed to communicate with Python tracer",
            traceback: err?.message || "The tracer process may have crashed or timed out.",
            line: line,
            filename: filename,
          };
        }
        
        event.line = line;
        // Ensure error events have filename for proper filtering
        if (event.event === "error" && !event.filename) {
          event.filename = filename;
        }
        
        if (event.event === "error") {
          console.error("Python tracer error:", event.error);
        }
        
        // If this is a function call, store the parent function's event (with locals) for later use
        // We'll use these locals to resolve args when tracing inside the expanded function
        if (fnName && event.locals) {
          // Store the parent function's event - we'll use its locals to resolve args later
          setParentFunctionEvents((prev) => ({ ...prev, [id]: event }));
          console.log(`[Function Call] Stored parent function event for ${fnName} at line ${line}`);
        }
        
        // Add event, but deduplicate to prevent showing same error multiple times
        setTraceEvents((prev) => {
          const exists = prev.some(e => {
            if (e.event === "error" && event.event === "error") {
              return e.line === event.line && 
                     e.error === event.error &&
                     e.filename === event.filename;
            } else if (e.event !== "error" && event.event !== "error") {
              return e.line === event.line && 
                     e.filename === event.filename &&
                     e.event === event.event;
            }
            return false;
          });
          return exists ? prev : [...prev, event];
        });
      } catch (err) {
        console.error("Error calling tracer:", err);
      }
    },
    [toggle, onFunctionClick, functions, traceEvents, parentFunctionEvents]
  );

  const getDisplayFnName = (fullId: string) => fullId.split("::").pop() || fullId;

  const renderEvents = (events: TraceEvent[]) => {
    if (!events?.length) return null;
    
    // Separate error events from regular events
    const errorEvents = events.filter(e => e.event === "error");
    const regularEvents = events.filter(e => e.event !== "error");
    
    return (
      <div
        style={{
          marginLeft: 12,
          fontSize: 11,
          fontFamily: "monospace",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Display error events prominently */}
        {errorEvents.map((ev, i) => (
          <div
            key={`error-${i}`}
            style={{
              backgroundColor: "#fee2e2",
              border: "1px solid #fca5a5",
              borderRadius: 4,
              padding: "8px",
              marginBottom: 8,
              color: "#991b1b",
              maxWidth: "600px",
              overflowX: "auto",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4, color: "#dc2626" }}>
              ⚠️ Exception
            </div>
            {ev.error && (
              <div style={{ marginBottom: 4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                <strong>Error:</strong> {ev.error}
              </div>
            )}
            {ev.traceback && (
              <details style={{ marginTop: 4 }}>
                <summary style={{ cursor: "pointer", color: "#991b1b", fontWeight: 500 }}>
                  Show traceback
                </summary>
                <pre
                  style={{
                    marginTop: 4,
                    padding: "4px",
                    backgroundColor: "#fef2f2",
                    borderRadius: 2,
                    fontSize: 10,
                    overflowX: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {ev.traceback}
                </pre>
              </details>
            )}
          </div>
        ))}
        
        {/* Display regular events */}
        {regularEvents.length > 0 && (
          <div
            style={{
              color: "#374151",
              backgroundColor: "#f3f4f6",
              padding: "6px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
              maxWidth: "500px",
              overflowX: "auto",
              whiteSpace: "pre",
            }}
          >
            {regularEvents.map((ev, i) => (
              <div
                key={`event-${i}`}
                style={{
                  borderBottom: i < regularEvents.length - 1 ? "1px dashed #d1d5db" : "none",
                  paddingBottom: 4,
                  marginBottom: 4,
                }}
              >
                {JSON.stringify(ev, null, 2)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // -------------------------------------------
  // RECURSIVE BODY RENDERER
  // -------------------------------------------

  const renderFunctionBody = useCallback(
    (fnData: FunctionData, prefixId: string, level = 0, omitFirstLine = false, currentEntryFullId?: string, callArgs?: { args: any[]; kwargs: Record<string, any> }, functionCallId?: string) => {
      const { body, start_line, file_path } = fnData;
      // Use provided entry_full_id or extract from prefixId
      // This ensures nested function calls use the correct function context for tracing
      const effectiveEntryFullId = currentEntryFullId || getEntryFullId(prefixId);
      // functionCallId is the ID of the function call that expanded this body (used to look up stored args)
      const storedArgsId = functionCallId || prefixId;
      const lines = body ? body.split("\n") : [];
      const visible = omitFirstLine ? lines.slice(1) : lines;
      const offset = omitFirstLine ? 1 : 0;

      return (
        <div style={{ position: "relative" }}>
          {visible.map((line, idx) => {
            const lineId = `${prefixId}-${idx}`;
            const currentLineNo = start_line + idx + offset;

            // First, filter events by line and filename
            const filteredEvents = traceEvents?.filter(
              (e) => {
                // Include error events - show them if they match the line or are recent errors
                if (e.event === "error") {
                  // Show error if:
                  // 1. Line matches exactly, OR
                  // 2. No line specified (show at function level), OR  
                  // 3. Line is within a few lines (show nearby errors)
                  const lineMatches = !e.line || 
                                     e.line === currentLineNo ||
                                     Math.abs((e.line || 0) - currentLineNo) <= 5;
                  
                  // Filename should match if specified
                  const filenameMatches = !e.filename || 
                                         e.filename === file_path ||
                                         file_path.endsWith(e.filename) ||
                                         e.filename.endsWith(file_path);
                  
                  return lineMatches && filenameMatches;
                }
                // For regular events, match line and filename
                return e.line === currentLineNo &&
                       e.filename &&
                       (e.filename === file_path ||
                        file_path.endsWith(e.filename) ||
                        e.filename.endsWith(file_path));
              }
            ) || [];

            // Check if there are any error events for this line
            const hasError = filteredEvents.some(e => e.event === "error" && e.line === currentLineNo);
            
            // Deduplicate error events (keep only unique errors based on error message and line)
            const seenErrors = new Set<string>();
            const events = filteredEvents.filter((e) => {
              if (e.event === "error") {
                // Create a unique key for this error
                const errorKey = `${e.line || 'no-line'}-${e.error || ''}`;
                if (seenErrors.has(errorKey)) {
                  return false; // Duplicate error, skip it
                }
                seenErrors.add(errorKey);
                return true;
              }
              // For regular events, only show them if there's no error for this line
              return !hasError;
            });
            const latestEvent = events && events.length > 0 ? events[events.length - 1] : undefined;
            const localsFromEvent = latestEvent?.locals;

            // ==========================================
            // FUNCTION CALL LINE
            // ==========================================
            // Find the most specific function match (longest function name that matches)
            // This prevents matching "get_metric_values" when the line actually calls "get_metric_values_in_time_range"
            let matchedFnName: string | null = null;
            let longestMatch = 0;
            
            for (const fnFullId of Object.keys(functions)) {
              if (!line) continue;
              // Extract function name from full ID (format: /path/to/file.py::function_name)
              const fnName = fnFullId.includes("::") ? fnFullId.split("::").pop()! : fnFullId;
              // Simple substring match - prefer longer function names to avoid substring matches
              if (line.includes(fnName) && !line.trim().startsWith("def ")) {
                // Prefer longer function names (more specific matches)
                if (fnName.length > longestMatch) {
                  matchedFnName = fnFullId; // Store the full ID
                  longestMatch = fnName.length;
                }
              }
            }
            
            if (matchedFnName) {
              // matchedFnName is the full ID (e.g., /path/to/file.py::function_name)
              const fnFullId = matchedFnName;
              // Extract just the function name for display and extraction
              const fnName = fnFullId.includes("::") ? fnFullId.split("::").pop()! : fnFullId;
              const id = `${lineId}-${fnFullId}`;
              const isExpanded = !!expanded[id];
              // Check if we have stored resolved args for this function call
              const storedResolvedArgs = resolvedCallArgs[id];
                
                // Only extract/resolve args when needed (on click or if already resolved)
                // This avoids calling extractCallArgs on every render
                // Only extract args for this specific function (fnName) - functions in the repo
                const getCallArgsForClick = () => {
                  if (storedResolvedArgs) {
                    return storedResolvedArgs;
                  }
                  // Extract args only for this specific function call (fnName is from functions object = repo functions only)
                  const extractedArgs = extractCallArgs(line, fnName);
                  return resolveCallArgs(extractedArgs || callArgs, localsFromEvent) || extractedArgs || callArgs;
                };

                return (
                  <div
                    key={id}
                    style={{
                      marginBottom: 2,
                      position: "relative",
                      borderLeft: isExpanded ? "1px solid #3b82f6" : "1px solid transparent",
                      paddingLeft: 6,
                      borderRadius: 2,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "flex-start",
                      }}
                    >
                      <span
                        style={{
                          marginRight: 12,
                          color: "#9ca3af",
                          minWidth: 32,
                          textAlign: "right",
                          userSelect: "none",
                          fontSize: 12,
                          fontFamily: "monospace",
                          paddingTop: 4,
                        }}
                      >
                        {currentLineNo}
                      </span>

                      {/* clickable call line */}
                      <div style={{ flex: 1 }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            // Function call clicked - extract args from the line (unresolved) and execute as normal line
                            // Args will be resolved from parent function's locals when lines inside are clicked
                            const extractedArgs = extractCallArgs(line, fnName);
                            if (extractedArgs) {
                              setExtractedCallArgs((prev) => ({ ...prev, [id]: extractedArgs }));
                            }
                            handleLineClick({
                              id,
                              filename: file_path,
                              line: currentLineNo,
                              fnName,
                              entryFullId: effectiveEntryFullId,
                              callArgs: callArgs, // Pass callArgs as-is, don't resolve yet
                            });
                          }}
                          style={{
                            cursor: "pointer",
                            display: "inline-block",
                            borderRadius: 4,
                            padding: "2px 4px",
                            fontFamily: "Fira Code, monospace",
                            fontSize: 14,
                            lineHeight: "1.45",
                            background: isExpanded
                              ? "rgba(59,130,246,0.1)"
                              : "transparent",
                            border: "none",
                            textAlign: "left",
                          }}
                        >
                          <MemoizedLine code={stripQualifiedCalls(line)} />
                        </button>
                      </div>

                      {renderEvents(events)}
                    </div>

                    <AnimatePresence>
                      {isExpanded && functions[fnFullId] && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          style={{ marginLeft: 18, overflow: "hidden", marginTop: 6 }}
                        >
                          <div
                            style={{
                              padding: 8,
                              borderRadius: 6,
                              borderLeft: "1px solid #3b82f6",
                              border: activeId === id ? "1px dashed #3b82f6" : "none",
                            }}
                          >
                            {/* Recursively render nested function - passes the called function's full_id and resolved arguments */}
                            {/* This allows nested function calls to be expanded and traced with correct context */}
                            {/* Pass the function call's id so we can look up stored args when tracing inside */}
                            {renderFunctionBody(
                              functions[fnFullId],
                              id,
                              level + 1,
                              true,
                              fnFullId,
                              storedResolvedArgs || callArgs,
                              id  // Pass the function call's id to look up stored args
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
            }

            // ==========================================
            // NORMAL LINE — ALSO CALLS TRACER
            // ==========================================

            return (
              <div
                key={lineId}
                onClick={async (e) => {
                  e.stopPropagation();
                  // If we're inside an expanded function (currentEntryFullId is set), 
                  // resolve args from the parent function's locals and spawn a new tracer
                  if (currentEntryFullId && functionCallId) {
                    // Get the parent function's event (stored when the function call was clicked)
                    const parentEvent = parentFunctionEvents[functionCallId];
                    
                    if (parentEvent && parentEvent.locals) {
                      // Check if this line contains a function call - if so, extract args from this line
                      let targetFunctionFullId: string | undefined = undefined;
                      let argsToResolve: { args: any[]; kwargs: Record<string, any> } | null = null;
                      
                      // Check if this line contains a function call to another function
                      // Find the most specific function match (longest function name that matches)
                      let matchedFnName: string | null = null;
                      let longestMatch = 0;
                      
                      for (const fnName of Object.keys(functions)) {
                        if (!line) continue;
                        // Match function name as a whole word (not just substring)
                        const fnCallPattern = new RegExp(`\\b${fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`);
                        if (fnCallPattern.test(line) && !line.trim().startsWith("def ")) {
                          // Prefer longer function names (more specific matches)
                          if (fnName.length > longestMatch) {
                            matchedFnName = fnName;
                            longestMatch = fnName.length;
                          }
                        }
                      }
                      
                      if (matchedFnName) {
                        // This line calls another function - extract args from this line
                        targetFunctionFullId = matchedFnName;
                        argsToResolve = extractCallArgs(line, matchedFnName);
                        console.log(`[Line Click] Found function call to ${matchedFnName} on line, extracted args:`, argsToResolve);
                      }
                      
                      // If no function call found on this line, use the stored extracted args
                      if (!argsToResolve) {
                        argsToResolve = extractedCallArgs[functionCallId];
                        targetFunctionFullId = currentEntryFullId;
                        console.log(`[Line Click] No function call on line, using stored args for ${targetFunctionFullId}:`, argsToResolve);
                      }
                      
                      if (argsToResolve && targetFunctionFullId) {
                        // Resolve args using parent function's locals and match to target function signature
                        // CRITICAL: We MUST have targetFunctionFullId to filter by signature
                        console.log(`[Line Click] Resolving args for function: ${targetFunctionFullId}`);
                        
                        let resolvedArgs;
                        try {
                          // Add timeout to prevent hanging
                          const timeoutPromise = new Promise((_, reject) => 
                            setTimeout(() => reject(new Error("Timeout resolving function arguments")), 10000)
                          );
                          resolvedArgs = await Promise.race([
                            resolveCallArgs(argsToResolve, parentEvent.locals, targetFunctionFullId),
                            timeoutPromise
                          ]) as { args: any[]; kwargs: Record<string, any> } | null;
                        } catch (err: any) {
                          console.error(`[Line Click] Error resolving args for ${targetFunctionFullId}:`, err);
                          // Create an error event to show to the user
                          const errorEvent: TraceEvent = {
                            event: "error",
                            error: `Failed to resolve arguments: ${err?.message || err?.toString() || "Unknown error"}`,
                            traceback: "The function signature lookup may have timed out or failed.",
                            line: currentLineNo,
                            filename: file_path,
                          };
                          setTraceEvents((prev) => {
                            const exists = prev.some(e => 
                              e.event === "error" && 
                              e.line === errorEvent.line && 
                              e.error === errorEvent.error &&
                              e.filename === errorEvent.filename
                            );
                            return exists ? prev : [...prev, errorEvent];
                          });
                          return;
                        }
                        
                        if (!resolvedArgs) {
                          console.error(`[Line Click] Failed to resolve args for ${targetFunctionFullId}`);
                          return;
                        }
                        
                        // Store resolved args for this function call
                        if (resolvedArgs) {
                          setResolvedCallArgs((prev) => ({ ...prev, [functionCallId]: resolvedArgs }));
                        }
                        
                        // Spawn new tracer for the function with resolved args
                        // If this line calls another function, use that function's full ID
                        const tracerEntryFullId = targetFunctionFullId || currentEntryFullId;
                        
                        // Ensure we only pass the resolved args (which should be filtered by signature)
                        if (!resolvedArgs) {
                          console.error(`[Line Click] Failed to resolve args for ${tracerEntryFullId}`);
                          return;
                        }
                        
                        console.log(`[Line Click] Calling tracer for ${tracerEntryFullId} with args:`, resolvedArgs);
                        handleLineClick({
                          id: lineId,
                          filename: file_path,
                          line: currentLineNo,
                          entryFullId: tracerEntryFullId,
                          callArgs: resolvedArgs, // Use resolved args (filtered by signature)
                        });
                        return;
                      }
                    }
                  }
                  
                  // Regular line or no parent event/extracted args - use current tracer
                  const entryIdForTracing = currentEntryFullId || effectiveEntryFullId;
                  handleLineClick({
                    id: lineId,
                    filename: file_path,
                    line: currentLineNo,
                    entryFullId: entryIdForTracing,
                    callArgs: callArgs,
                  });
                }}
                style={{
                  marginBottom: 2,
                  marginLeft: level * 16,
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "flex-start",
                  cursor: "pointer",
                  borderLeft: "2px solid transparent",
                  paddingLeft: 6,
                  transition: "all 0.12s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#f0f9ff";
                  e.currentTarget.style.borderLeft = "2px solid #93c5fd";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.borderLeft = "2px solid transparent";
                }}
              >
                <div
                  style={{
                    marginRight: 12,
                    color: "#9ca3af",
                    minWidth: 32,
                    textAlign: "right",
                    userSelect: "none",
                    fontSize: 12,
                    fontFamily: "monospace",
                    paddingTop: 2,
                  }}
                >
                  {currentLineNo}
                </div>

                <div style={{ flex: 1 }}>
                  <MemoizedLine code={stripQualifiedCalls(line)} />
                </div>

                {renderEvents(events)}
              </div>
            );
          })}
        </div>
      );
    },
    [expanded, functions, handleLineClick, activeId, traceEvents, resolvedCallArgs, parentFunctionEvents, extractedCallArgs]
  );

  // -------------------------------------------
  // panel root
  // -------------------------------------------

  return (
    <div
      style={{
        flex: 1,
        padding: 16,
        overflowY: "auto",
        backgroundColor: "#f9fafb",
        color: "#111827",
        fontFamily: "Fira Code, monospace",
      }}
    >
      {parents.length === 0 && <p>Loading parents...</p>}

      {parents.map((parent) => {
        const fnData = functions[parent];
        const isExpanded = !!expanded[parent];

        return (
          <div key={parent} style={{ marginBottom: 12 }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggle(parent);
                onFunctionClick?.(parent);
              }}
              style={{
                width: "100%",
                textAlign: "left",
                backgroundColor: isExpanded ? "#e0f2fe" : "#f3f4f6",
                padding: "8px 12px",
                borderRadius: 6,
                fontWeight: 600,
                cursor: "pointer",
                border: "1px solid #d1d5db",
              }}
            >
              {getDisplayFnName(parent)}
            </button>

            <AnimatePresence initial={false}>
              {isExpanded && fnData && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  style={{ marginLeft: 16, marginTop: 8 }}
                >
                  <div
                    style={{
                      backgroundColor: "#ffffff",
                      padding: 12,
                      borderRadius: 6,
                      fontSize: 14,
                      lineHeight: "1.45",
                      color: "#111827",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                      borderLeft: "1px solid #3b82f6",
                    }}
                  >
                    {renderFunctionBody(fnData, parent, 0, false, parent)}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
};

export default React.memo(FlowPanel);
