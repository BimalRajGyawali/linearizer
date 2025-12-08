// --- imports ---
import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { prism as lightTheme } from "react-syntax-highlighter/dist/esm/styles/prism";
import { invoke } from "@tauri-apps/api/core";

interface TraceEvent {
  event: string;
  filename: string;
  function: string;
  line?: number;
  locals?: Record<string, any>;
  value?: any;
  result?: any;
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
    }: {
      id: string;
      filename: string;
      line: number;
      fnName?: string; // only present for function-call lines
    }) => {
      toggle(id);
      setActiveId(id);

      if (fnName) onFunctionClick?.(fnName);

      try {
        const traceReq = {
          entry_full_id: getEntryFullId(id),
          stop_line: line,
          args_json: JSON.stringify({
            args: [],
            kwargs: { metric_name: "test", period: "last_7_days" },
          }),
          filename,
        };
        console.log(`Trace request ${JSON.stringify(traceReq)}, fn: ${fnName}`)
        const event = await invoke<TraceEvent>("get_tracer_data", { req: traceReq });
        // event.line = event.line - 1;
        setTraceEvents((prev) => [...prev, event]);
      } catch (err) {
        console.error("Error calling tracer:", err);
      }
    },
    [toggle, onFunctionClick]
  );

  const getDisplayFnName = (fullId: string) => fullId.split("::").pop() || fullId;

  const renderEvents = (events: TraceEvent[]) => {
    if (!events?.length) return null;
    return (
      <div
        style={{
          marginLeft: 12,
          fontSize: 11,
          fontFamily: "monospace",
          color: "#374151",
          backgroundColor: "#f3f4f6",
          padding: "6px",
          borderRadius: 4,
          border: "1px solid #d1d5db",
          maxWidth: "500px",
          overflowX: "auto",
          whiteSpace: "pre",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {events.map((ev, i) => (
          <div
            key={i}
            style={{
              borderBottom: i < events.length - 1 ? "1px dashed #d1d5db" : "none",
              paddingBottom: 4,
              marginBottom: 4,
            }}
          >
            {JSON.stringify(ev, null, 2)}
          </div>
        ))}
      </div>
    );
  };

  // -------------------------------------------
  // RECURSIVE BODY RENDERER
  // -------------------------------------------

  const renderFunctionBody = useCallback(
    (fnData: FunctionData, prefixId: string, level = 0, omitFirstLine = false) => {
      const { body, start_line, file_path } = fnData;
      const lines = body ? body.split("\n") : [];
      const visible = omitFirstLine ? lines.slice(1) : lines;
      const offset = omitFirstLine ? 1 : 0;

      return (
        <div style={{ position: "relative" }}>
          {visible.map((line, idx) => {
            const lineId = `${prefixId}-${idx}`;
            const currentLineNo = start_line + idx + offset;

            const events = traceEvents?.filter(
              (e) =>
                e.line === currentLineNo &&
                (e.filename === file_path ||
                  file_path.endsWith(e.filename) ||
                  e.filename.endsWith(file_path))
            );

            // ==========================================
            // FUNCTION CALL LINE
            // ==========================================
            for (const fnName of Object.keys(functions)) {
              if (!line) continue;
              if (line.includes(fnName) && !line.trim().startsWith("def ")) {
                const id = `${lineId}-${fnName}`;
                const isExpanded = !!expanded[id];

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
                            handleLineClick({
                              id,
                              filename: file_path,
                              line: currentLineNo,
                              fnName,
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
                          <MemoizedLine code={line.replace(fnName, getDisplayFnName(fnName))} />
                        </button>
                      </div>

                      {renderEvents(events)}
                    </div>

                    <AnimatePresence>
                      {isExpanded && functions[fnName] && (
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
                            {renderFunctionBody(functions[fnName], id, level + 1, true)}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              }
            }

            // ==========================================
            // NORMAL LINE — ALSO CALLS TRACER
            // ==========================================

            return (
              <div
                key={lineId}
                onClick={(e) => {
                  e.stopPropagation();
                  handleLineClick({
                    id: lineId,
                    filename: file_path,
                    line: currentLineNo,
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
    [expanded, functions, handleLineClick, activeId, traceEvents]
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
                    {renderFunctionBody(fnData, parent)}
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
