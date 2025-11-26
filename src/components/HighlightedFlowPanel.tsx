import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { prism as lightTheme } from "react-syntax-highlighter/dist/esm/styles/prism";

interface FlowPanelProps {
  parents: string[];
  functions: Record<string, string>;
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

const FlowPanel: React.FC<FlowPanelProps> = ({ parents, functions }) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [activeId, setActiveId] = useState<string | null>(null); // Track last clicked function

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleClick = useCallback((id: string) => {
    toggle(id);
    setActiveId(id); // mark as active for dashed border
  }, [toggle]);

  const renderFunctionBody = useCallback(
    (body: string, prefixId: string, level = 0, omitFirstLine = false) => {
      const lines = body ? body.split("\n") : [];
      const visible = omitFirstLine ? lines.slice(1) : lines;

      return (
        <div style={{ position: "relative" }}>
          {visible.map((line, idx) => {
            const lineId = `${prefixId}-${idx}`;
            let rendered = false;

            for (const fnName of Object.keys(functions)) {
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
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleClick(id);
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
                        border: "none"
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
    [expanded, functions, handleClick, activeId]
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
        const body = functions[parent];
        const isExpanded = !!expanded[parent];

        return (
          <div key={parent} style={{ marginBottom: 12 }}>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleClick(parent);
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
