import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";

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
  const lines = body.split("\n");
  const renderLines = omitFirstLine ? lines.slice(1) : lines;

  return (
    <div style={{ position: "relative" }}>
      {renderLines.map((line, idx) => {
        let lineRendered = false;

        for (const fnName of Object.keys(functions)) {
          console.log("Checking line for function:", fnName);
          console.log("Current line:", line);
          // Skip if line does not include the function or it's part of the definition line
          if (line.includes(fnName) && !line.trim().startsWith("def ")) {
            console.log("Line includes function call:", line);
            const id = `${prefixId}:${fnName}:${idx}`;
            const before = line.split(fnName)[0];
            const after = line.split(fnName)[1];
            const isExpanded = !!expanded[id];

            lineRendered = true;

            return (
              <div key={id} style={{ marginBottom: "6px", position: "relative" }}>
                {/* Clickable function call */}
                <div
                  style={{
                    display: "inline-block",
                    // padding: "2px 6px",
                    borderRadius: "4px",
                    backgroundColor: isExpanded ? "rgba(0,0,0,0.05)" : "transparent",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "Fira Code, monospace",
                    fontSize: "14px",
                    marginTop: "2px",
                    marginBottom: "2px",
                    opacity: isExpanded ? 0.7 : 1,
                    lineHeight: "1.5rem",
                  }}
                  tabIndex={0}
                  onClick={() => toggle(id)}
                  onKeyDown={(e) => e.key === "Enter" && toggle(id)}
                >
                  <span>{before}</span>
                  <span>{fnName}</span>
                  <span>{after}</span>
                </div>

                {/* Expanded inline function */}
                <AnimatePresence>
                  {isExpanded && functions[fnName] && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      style={{ marginLeft: "16px", marginTop: "2px" }}
                    >
                      <div
                        style={{
                          backgroundColor: "#f7f7f7",
                          padding: "8px",
                          borderRadius: "6px",
                          fontFamily: "Fira Code, monospace",
                          fontSize: "14px",
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
                fontSize: "14px",
                lineHeight: "1.5rem",
                marginLeft: level * 16,
              }}
            >
              {line}
            </div>
          );
        }
      })}
    </div>
  );
};


  return (
    <div className="p-6 max-w-4xl mx-auto font-sans">
      {parents.length === 0 && <p>Loading parents...</p>}

      {parents.map((parent) => {
        const body = functions[parent];
        const isExpanded = !!expanded[parent];

        return (
          <div key={parent} style={{ marginBottom: "12px" }}>
            {/* Parent function clickable */}
            <div
              style={{
                backgroundColor: "#e5e7eb",
                padding: "8px 12px",
                borderRadius: "6px",
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
                  style={{ marginLeft: "16px", marginTop: "4px" }}
                >
                  <div
                    style={{
                      backgroundColor: "#f7f7f7",
                      padding: "8px",
                      borderRadius: "6px",
                      fontFamily: "Fira Code, monospace",
                      fontSize: "14px",
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
