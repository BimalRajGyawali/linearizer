import React, { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

interface FlowPanelProps {
  parents: string[];
  functions: Record<string, string>;
}

const MemoizedLine: React.FC<{ code: string }> = React.memo(
  ({ code }) => (
    <SyntaxHighlighter
      language="python"
      style={vscDarkPlus}
      PreTag="div"
      customStyle={{
        margin: 0,
        padding: 0,
        background: "transparent",
        display: "inline",
        fontFamily: "Fira Code, monospace",
        fontSize: 14,
        lineHeight: "1.45",
        whiteSpace: "pre-wrap",
      }}
      codeTagProps={{ style: { whiteSpace: "pre-wrap", display: "inline" } }}
    >
      {code}
    </SyntaxHighlighter>
  ),
  (prev, next) => prev.code === next.code
);

const FlowPanel: React.FC<FlowPanelProps> = ({ parents, functions }) => {
  // Local expanded state for minimal re-renders
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const renderFunctionBody = useCallback(
    (body: string, prefixId: string, level = 0, omitFirstLine = false) => {
      const lines = body ? body.split("\n") : [];
      const visible = omitFirstLine ? lines.slice(1) : lines;

      return (
        <div style={{ position: "relative" }}>
          {visible.map((line, idx) => {
            const lineId = `${prefixId}-${idx}`;
            let rendered = false;

            // Check for nested function calls
            for (const fnName of Object.keys(functions)) {
              if (!line) continue;
              if (line.includes(fnName) && !line.trim().startsWith("def ")) {
                const id = `${lineId}-${fnName}`;
                const isExpanded = !!expanded[id];

                rendered = true;
                return (
                  <div key={id} style={{ marginBottom: 2, position: "relative" }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggle(id);
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
                          ? "rgba(255,255,255,0.03)"
                          : "transparent",
                        border: "none",
                      }}
                    >
                      <MemoizedLine code={line} />
                    </button>

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
                              backgroundColor: "#1e1e1e",
                              padding: 8,
                              borderRadius: 6,
                              boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
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
                  style={{
                    marginBottom: 2,
                    marginLeft: level * 16,
                  }}
                >
                  <MemoizedLine code={line} />
                </div>
              );
            }

            return null;
          })}
        </div>
      );
    },
    [expanded, functions, toggle]
  );

  return (
    <div
      style={{
        flex: 1,
        padding: 16,
        overflowY: "auto",
        backgroundColor: "#0f1720",
        color: "#e5e7eb",
      }}
    >
      {parents.length === 0 && <p>Loading parents...</p>}

      {parents.map((parent) => {
        const body = functions[parent];
        const isExpanded = !!expanded[parent];

        return (
          <div key={parent} style={{ marginBottom: 12 }}>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggle(parent);
              }}
              style={{
                width: "100%",
                textAlign: "left",
                backgroundColor: "#111827",
                padding: "8px 12px",
                borderRadius: 6,
                fontFamily: "Fira Code, monospace",
                fontWeight: 600,
                cursor: "pointer",
                color: "#f3f4f6",
                border: "none",
              }}
            >
              {parent}
            </button>

            <AnimatePresence initial={false}>
              {isExpanded && body && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  style={{ marginLeft: 16, marginTop: 8 }}
                >
                  <div
                    style={{
                      backgroundColor: "#0b1220",
                      padding: 12,
                      borderRadius: 6,
                      fontFamily: "Fira Code, monospace",
                      fontSize: 14,
                      lineHeight: "1.45",
                      color: "#e5e7eb",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                    }}
                  >
                    {renderFunctionBody(body, parent)}
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
