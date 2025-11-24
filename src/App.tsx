// App.tsx
import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import FileExplorer from "./components/FileExplorer";

export default function App() {
  const [parents, setParents] = useState<string[]>([]);
  const [functions, setFunctions] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Toggle accordion or inline function
  const toggle = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Fetch parents and functions JSON from backend
  const fetchFlows = async () => {
    try {
      const result: any = await invoke("get_flows"); // should return { parents: [], functions: {} }
      setParents(result.parents || []);
      setFunctions(result.functions || {});
    } catch (e) {
      console.error("Error fetching flows:", e);
    }
  };

  useEffect(() => {
    fetchFlows();
  }, []);

  // Recursive rendering of function body
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
            // Skip if line does not include the function or it's the def line
            if (!line) continue;
            if (line.includes(fnName) && !line.trim().startsWith("def ")) {
              const id = `${prefixId}:${fnName}:${idx}`;
              const parts = line.split(fnName);
              const before = parts[0] ?? "";
              const after = parts.slice(1).join(fnName) ?? "";
              const isExpanded = !!expanded[id];

              lineRendered = true;

              return (
                <div key={id} style={{ marginBottom: "6px", position: "relative" }}>
                  {/* Clickable function call */}
                  <div
                    style={{
                      display: "inline-block",
                      borderRadius: "4px",
                      backgroundColor: isExpanded ? "rgba(0,0,0,0.05)" : "transparent",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "Fira Code, monospace",
                      fontSize: "14px",
                      marginTop: "2px",
                      marginBottom: "2px",
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

                  {/* Expanded inline function */}
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

          // If line wasn't a function call, just render normally
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

  // ---------- LAYOUT ----------
  return (
    <div
      style={{
        display: "flex",
        height: "100vh", // ensures full-height so sidebar and center align
        width: "100vw",
        overflow: "hidden",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* LEFT SIDEBAR */}
      <div
        style={{
          width: 280,
          minWidth: 220,
          maxWidth: 360,
          backgroundColor: "#f3f4f6",
          borderRight: "1px solid #e5e7eb",
          overflowY: "auto",
          padding: 12,
        }}
      >
        <FileExplorer />
      </div>

      {/* CENTER PANEL (Flows UI) */}
      <div
        style={{
          flex: 1,
          padding: 18,
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
              {/* Parent function clickable */}
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
    </div>
  );
}
