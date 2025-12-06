import React, { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { prism as lightTheme } from "react-syntax-highlighter/dist/esm/styles/prism";
import {invoke} from "@tauri-apps/api/core";

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
}) => {
  const [cursorLine, setCursorLine] = useState<{ id: string; lineNo: number; funcId: string } | null>(null);
  const [activeEvent, setActiveEvent] = useState<TraceEvent | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null); // last clicked function
  const lineRefs = useRef<Record<string, HTMLDivElement>>({});

  const getDisplayFnName = (fullId: string) => fullId.split("::").pop() || fullId;

  function stripQualifiedCalls(line: string) {
    return line.replace(/[A-Za-z0-9_\/\.\-]+\.py::([A-Za-z_]\w*)\s*\(/g, (_, fn) => fn + "(");
  }

  // Fetch line event from Rust/Python
  const fetchLineEvent = useCallback(async (funcId: string, lineNo: number) => {
    try {
      const result: any = await invoke("get_next_tracer_event", {
          entryFullId: funcId,
          lineNumber: lineNo,
          argsJson: '{"kwargs": {"metric_name": "test", "period": "last_7_days"}}'
      });

        console.log(result)
      if (result?.events?.length > 0) return result.events[0];
    } catch (e) {
      console.error("Error fetching line event:", e);
    }
    return null;
  }, []);

  // Handle cursor move
  const handleCursorMove = useCallback(
    async (nextLineId: string, nextLineNo: number, funcId: string) => {
      setCursorLine({ id: nextLineId, lineNo: nextLineNo, funcId });

      // fetch event for this line
      const event = await fetchLineEvent(funcId, nextLineNo);
      setActiveEvent(event);

      // scroll line into view
      const el = lineRefs.current[nextLineId];
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [fetchLineEvent]
  );

  const renderFunctionBody = useCallback(
    (fnData: FunctionData, funcId: string, level = 0, omitFirstLine = false) => {
      const { body, start_line } = fnData;
      const lines = body.split("\n");
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
              </div>
            );
          })}
        </div>
      );
    },
    [cursorLine, activeEvent, handleCursorMove]
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
