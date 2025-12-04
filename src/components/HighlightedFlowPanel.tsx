import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { prism as lightTheme } from "react-syntax-highlighter/dist/esm/styles/prism";

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
  traceEvents?: TraceEvent[];
}


// Memoized line to prevent flash
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

const FlowPanel: React.FC<FlowPanelProps> = ({
  parents,
  functions,
  expanded,
  toggle,
  onFunctionClick,
  traceEvents = [],
}) => {
  // const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [activeId, setActiveId] = useState<string | null>(null); // Track last clicked function

  // const toggle = useCallback((id: string) => {
  //   setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  // }, []);

  const handleClick = useCallback((id: string) => {
    toggle(id);
    setActiveId(id); // mark as active for dashed border
  }, [toggle]);

  const getDisplayFnName = (fullId: string) => {
    let dispName = fullId.split("::").pop() || fullId;
    return dispName;
  }

  function stripQualifiedCalls(line: string): string {
    // Find patterns like   something.py::funcName(
    return line.replace(
      /[A-Za-z0-9_\/\.\-]+\.py::([A-Za-z_]\w*)\s*\(/g,
      (_, fn) => fn + "("
    );
  }

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
            console.log(lineId, currentLineNo, file_path);
            // Find trace events for this line
            const events = traceEvents.filter(
              (e) =>
                e.line === currentLineNo &&
                // Normalize paths for comparison if needed, or assume exact match
                (e.filename === file_path || file_path.endsWith(e.filename) || e.filename.endsWith(file_path))
            );

            // Debug matching
            if (traceEvents.length > 0) {
              const potential = traceEvents.filter(e => e.line === currentLineNo);
              if (potential.length > 0) {
                console.log(`Line ${currentLineNo} (type: ${typeof currentLineNo}): Found ${potential.length} events. Match results:`,
                  potential.map(e => ({
                    filename: e.filename,
                    file_path,
                    match: (e.filename === file_path || file_path.endsWith(e.filename) || e.filename.endsWith(file_path))
                  }))
                );
              }
            }

            let rendered = false;

            for (const fnName of Object.keys(functions)) {
              const displayFnName = getDisplayFnName(fnName);
              if (!line) continue;
              if (line.includes(fnName) && !line.trim().startsWith("def ")) {
                const id = `${lineId}-${fnName}`;
                const isExpanded = !!expanded[id];
                rendered = true;

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
                    <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline" }}>
                      <span style={{
                        marginRight: 12,
                        color: "#9ca3af",
                        minWidth: 32,
                        textAlign: "right",
                        userSelect: "none",
                        fontSize: 12,
                        fontFamily: "monospace"
                      }}>
                        {currentLineNo}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleClick(id);
                          onFunctionClick?.(fnName);
                        }}
                        style={{
                          cursor: "pointer",
                          display: "inline-block",
                          borderRadius: 4,
                          padding: "2px 4px",
                          fontFamily: "Fira Code, monospace",
                          fontSize: 14,
                          lineHeight: "1.45",
                          background: isExpanded ? "rgba(59,130,246,0.1)" : "transparent",
                          border: "none",
                          textAlign: "left"
                        }}
                      >
                        <MemoizedLine code={line.replace(fnName, displayFnName)} />
                      </button>
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
                              borderRadius: 6, borderLeft: "1px solid #3b82f6",

                              border: activeId === id ? "1px dashed #3b82f6" : "none", // dashed only for last clicked
                            }}
                          >
                            {renderFunctionBody(
                              functions[fnName],
                              id,
                              level + 1,
                              true
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              }
            }

            if (!rendered) {
              return (
                <div
                  key={lineId}
                  style={{
                    marginBottom: 2,
                    marginLeft: level * 16,
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "flex-start",
                  }}
                >
                  <div style={{
                    marginRight: 12,
                    color: "#9ca3af",
                    minWidth: 32,
                    textAlign: "right",
                    userSelect: "none",
                    fontSize: 12,
                    fontFamily: "monospace",
                    paddingTop: 2 // Align with code
                  }}>
                    {currentLineNo}
                  </div>
                  <div style={{ flex: 1 }}>
                    <MemoizedLine code={stripQualifiedCalls(line)} />
                  </div>
                  {events.length > 0 && (
                    <div
                      style={{
                        marginLeft: 12,
                        fontSize: 12,
                        fontFamily: "monospace",
                        color: "#6b7280",
                        backgroundColor: "#f3f4f6",
                        padding: "2px 6px",
                        borderRadius: 4,
                        border: "1px solid #e5e7eb",
                        maxWidth: "400px",
                        overflowX: "auto",
                      }}
                    >
                      {events.map((ev, i) => (
                        <div key={i}>
                          {ev.event === "return" ? (
                            <span style={{ color: "#059669" }}>
                              return {JSON.stringify(ev.value)}
                            </span>
                          ) : (
                            <span>
                              {ev.locals &&
                                Object.entries(ev.locals).map(([k, v]) => (
                                  <span key={k} style={{ marginRight: 8 }}>
                                    <span style={{ color: "#2563eb" }}>{k}</span>=
                                    <span style={{ color: "#d97706" }}>{JSON.stringify(v)}</span>
                                  </span>
                                ))}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            return null;
          })}
        </div>
      );
    },
    [expanded, functions, handleClick, activeId, traceEvents]
  );

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
                e.preventDefault();
                e.stopPropagation();
                handleClick(parent);
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
              {parent.split("::").pop() || parent}
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
                      borderLeft: "1px solid #3b82f6", // solid left border for parent
                    }}
                  >
                    {renderFunctionBody(functions[parent], parent)}
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
