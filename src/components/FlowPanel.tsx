import React from "react";
import { motion, AnimatePresence } from "framer-motion";

interface FlowPanelProps {
  parents: string[];
  functions: Record<string, string>;
  expanded: Record<string, boolean>;
  toggle: (id: string) => void;
}

export default function FlowPanel({ parents, functions, expanded, toggle }: FlowPanelProps) {
  const renderFunctionBody = (
    body: string,
    prefixId: string,
    level = 0,
    omitFirstLine = false
  ) => {
    const lines = body ? body.split("\n") : [];
    const renderLines = omitFirstLine ? lines.slice(1) : lines;

    return (
      <div style={{ position: "relative" }}>
        {renderLines.map((line, idx) => {
          let lineRendered = false;

          for (const fnName of Object.keys(functions)) {
            if (!line) continue;
            if (line.includes(fnName) && !line.trim().startsWith("def ")) {
              const id = `${prefixId}:${fnName}:${idx}`;
              const parts = line.split(fnName);
              const before = parts[0] ?? "";
              const after = parts.slice(1).join(fnName) ?? "";
              const isExpanded = !!expanded[id];
              lineRendered = true;

              return (
                <div key={id} style={{ marginBottom: 6, position: "relative" }}>
                  <div
                    style={{
                      display: "inline-block",
                      borderRadius: 4,
                      backgroundColor: isExpanded ? "rgba(0,0,0,0.05)" : "transparent",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "Fira Code, monospace",
                      fontSize: 14,
                      marginTop: 2,
                      marginBottom: 2,
                      opacity: isExpanded ? 0.85 : 1,
                      lineHeight: "1.5rem",
                      whiteSpace: "pre-wrap",
                    }}
                    tabIndex={0}
                    onClick={() => toggle(id)}
                    onKeyDown={(e) => e.key === "Enter" && toggle(id)}
                  >
                    <span>{before}</span>
                    <span style={{ textDecoration: "underline" }}>{fnName}</span>
                    <span>{after}</span>
                  </div>

                  <AnimatePresence>
                    {isExpanded && functions[fnName] && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        style={{ marginLeft: 16, marginTop: 6, overflow: "hidden" }}
                      >
                        <div
                          style={{
                            backgroundColor: "#f7f7f7",
                            padding: 8,
                            borderRadius: 6,
                            fontFamily: "Fira Code, monospace",
                            fontSize: 14,
                            lineHeight: "1.5rem",
                            color: "#333",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
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

          if (!lineRendered) {
            return (
              <div
                key={`${prefixId}:${idx}`}
                style={{
                  fontFamily: "Fira Code, monospace",
                  fontSize: 14,
                  lineHeight: "1.5rem",
                  marginLeft: level * 16,
                  whiteSpace: "pre-wrap",
                }}
              >
                {line}
              </div>
            );
          }
          return null;
        })}
      </div>
    );
  };

  return (
    <div
      style={{
        flex: 1,
        padding: 16,
        overflowY: "auto",
        backgroundColor: "#ffffff",
      }}
    >
      {parents.length === 0 && <p>Loading parents...</p>}

      {parents.map((parent) => {
        const body = functions[parent];
        const isExpanded = !!expanded[parent];

        return (
          <div key={parent} style={{ marginBottom: 12 }}>
            <div
              style={{
                backgroundColor: "#e5e7eb",
                padding: "8px 12px",
                borderRadius: 6,
                fontFamily: "Fira Code, monospace",
                fontWeight: 600,
                cursor: "pointer",
              }}
              onClick={() => toggle(parent)}
            >
              {parent}
            </div>

            <AnimatePresence>
              {isExpanded && body && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  style={{ marginLeft: 16, marginTop: 8 }}
                >
                  <div
                    style={{
                      backgroundColor: "#f7f7f7",
                      padding: 8,
                      borderRadius: 6,
                      fontFamily: "Fira Code, monospace",
                      fontSize: 14,
                      lineHeight: "1.5rem",
                      color: "#333",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                    }}
                  >
                    {renderFunctionBody(body, parent, 0, false)}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
