import React, { useState, useCallback, useRef } from "react";
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
  traceEvents?: TraceEvent[];
}

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
  const [cursorLine, setCursorLine] = useState<{ id: string; lineNo: number; funcId: string } | null>(null);
  const [activeEvent, setActiveEvent] = useState<TraceEvent | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const lineRefs = useRef<Record<string, HTMLDivElement>>({});

  const getDisplayFnName = (fullId: string) => fullId.split("::").pop() || fullId;

  function stripQualifiedCalls(line: string) {
    return line.replace(/[A-Za-z0-9_\/\.\-]+\.py::([A-Za-z_]\w*)\s*\(/g, (_, fn) => fn + "(");
  }

  const fetchLineEvent = useCallback(async (funcId: string, lineNo: number) => {
    try {
      const result: any = await invoke("get_next_tracer_event", {
        entryFullId: funcId,
        lineNumber: lineNo,
        argsJson: '{"kwargs": {"metric_name": "test", "period": "last_7_days"}}'
      });
      if (result?.events?.length > 0) return result.events[0];
    } catch (e) {
      console.error("Error fetching line event:", e);
    }
    return null;
  }, []);

  const handleCursorMove = useCallback(
    async (nextLineId: string, nextLineNo: number, funcId: string) => {
      setCursorLine({ id: nextLineId, lineNo: nextLineNo, funcId });

      const event = await fetchLineEvent(funcId, nextLineNo);
      setActiveEvent(event);

      const el = lineRefs.current[nextLineId];
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [fetchLineEvent]
  );

  const renderEvents = (events: TraceEvent[]) => {
    if (!events || events.length === 0) return null;
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
          <div key={i} style={{ borderBottom: i < events.length - 1 ? "1px dashed #d1d5db" : "none", paddingBottom: 4, marginBottom: 4 }}>
            {JSON.stringify(ev, null, 2)}
          </div>
        ))}
      </div>
    );
  };

  const renderFunctionBody = useCallback(
    (fnData: FunctionData, funcId: string, level = 0, omitFirstLine = false) => {
      const { body, start_line, file_path } = fnData;
      const lines = body ? body.split("\n") : [];
      const visible = omitFirstLine ? lines.slice(1) : lines;
      const offset = omitFirstLine ? 1 : 0;

      return (
        <div style={{ position: "relative" }}>
          {visible.map((line, idx) => {
            const lineId = `${funcId}-${idx}`;
            const currentLineNo = start_line + idx + offset;

            const refCallback = (el: HTMLDivElement) => {
              if (el) lineRefs.current[lineId] = el;
            };

            const isCursor = cursorLine?.id === lineId;

            const events = traceEvents.filter(
              (e) =>
                e.line === currentLineNo &&
                (e.filename === file_path || file_path.endsWith(e.filename) || e.filename.endsWith(file_path))
            );

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
                    <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start" }}>
                      <span style={{
                        marginRight: 12,
                        color: "#9ca3af",
                        minWidth: 32,
                        textAlign: "right",
                        userSelect: "none",
                        fontSize: 12,
                        fontFamily: "monospace",
                        paddingTop: 4
                      }}>
                        {currentLineNo}
                      </span>
                      <div style={{ flex: 1 }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggle(id);
                            setActiveId(id);
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

            if (!rendered) {
              return (
                <div
                  key={lineId}
                  ref={refCallback}
                  style={{
                    marginBottom: 2,
                    marginLeft: level * 16,
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "flex-start",
                    backgroundColor: isCursor ? "rgba(59,130,246,0.1)" : "transparent",
                    borderRadius: 4,
                    paddingLeft: 4,
                    cursor: "pointer",
                  }}
                  onClick={() => handleCursorMove(lineId, currentLineNo, funcId)}
                >
                  <div style={{
                    marginRight: 12,
                    color: "#9ca3af",
                    minWidth: 32,
                    textAlign: "right",
                    userSelect: "none",
                    fontSize: 12,
                    fontFamily: "monospace",
                    paddingTop: 2
                  }}>
                    {currentLineNo}
                  </div>
                  <div style={{ flex: 1 }}>
                    <MemoizedLine code={stripQualifiedCalls(line)} />
                    {isCursor && activeEvent && (
                      <div
                        style={{
                          fontSize: 11,
                          fontFamily: "monospace",
                          color: "#111827",
                          backgroundColor: "#f3f4f6",
                          padding: 4,
                          borderRadius: 4,
                          marginTop: 2,
                        }}
                      >
                        {JSON.stringify(activeEvent, null, 2)}
                      </div>
                    )}
                  </div>
                  {renderEvents(events)}
                </div>
              );
            }

            return null;
          })}
        </div>
      );
    },
    [expanded, functions, toggle, activeId, traceEvents, cursorLine, activeEvent, handleCursorMove]
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
                toggle(parent);
                setActiveId(parent);
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
