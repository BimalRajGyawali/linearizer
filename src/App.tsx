import React, { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import FileExplorer from "./components/FileExplorer";

export default function App() {
  const [parents, setParents] = useState<string[]>([]);
  const [functions, setFunctions] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Sidebar width and dragging
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [collapsed, setCollapsed] = useState(false);
  const lastSidebarWidth = useRef(sidebarWidth);
  const [draggingOverlay, setDraggingOverlay] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const COLLAPSED_WIDTH = 40; // Minimum clickable width

  // Toggle function expansion
  const toggle = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Fetch parents and functions
  const fetchFlows = async () => {
    try {
      const result: any = await invoke("get_flows");
      setParents(result.parents || []);
      setFunctions(result.functions || {});
    } catch (e) {
      console.error("Error fetching flows:", e);
    }
  };

  useEffect(() => {
    fetchFlows();
  }, []);

  // Sidebar collapse/expand
  const toggleSidebar = () => {
    if (!collapsed) {
      lastSidebarWidth.current = sidebarWidth;
      setSidebarWidth(COLLAPSED_WIDTH);
      setCollapsed(true);
    } else {
      setSidebarWidth(lastSidebarWidth.current || 280);
      setCollapsed(false);
    }
  };

  // Drag handlers
  const startDrag = () => {
    dragging.current = true;
    setDraggingOverlay(true);
    document.body.style.cursor = "col-resize";
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!dragging.current) return;
    let newWidth = e.clientX;
    if (newWidth < COLLAPSED_WIDTH) newWidth = COLLAPSED_WIDTH;
    if (newWidth > 600) newWidth = 600;
    setSidebarWidth(newWidth);
    if (collapsed && newWidth > COLLAPSED_WIDTH) setCollapsed(false);
  };

  const onMouseUp = () => {
    dragging.current = false;
    setDraggingOverlay(false);
    document.body.style.cursor = "default";
  };

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [collapsed]);

  // Render function body recursively
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

  // ---------- LAYOUT ----------
  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* SIDEBAR */}
      <div
        ref={sidebarRef}
        style={{
          width: sidebarWidth,
          minWidth: COLLAPSED_WIDTH,
          maxWidth: 600,
          backgroundColor: "#f3f4f6",
          borderRight: "1px solid #e5e7eb",
          display: "flex",
          flexDirection: "column",
          transition: "width 0.2s",
          position: "relative",
        }}
      >
        {/* Collapse Button (subtle) */}
        <div
          onClick={toggleSidebar}
          style={{
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            userSelect: "none",
            color: "#888",
            fontSize: 14,
            opacity: 0.5,
            transition: "opacity 0.2s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}
        >
          {collapsed ? "➡" : "⬅"}
        </div>

        {/* FileExplorer scrolls */}
        {!collapsed && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <FileExplorer />
          </div>
        )}
      </div>

      {/* DRAG HANDLE */}
      <div
        onMouseDown={startDrag}
        style={{
          width: 4,
          cursor: "col-resize",
          backgroundColor: "transparent",
          zIndex: 10,
        }}
      />

      {/* OVERLAY DURING DRAG */}
      {draggingOverlay && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            zIndex: 9999,
            cursor: "col-resize",
            backgroundColor: "transparent",
          }}
        />
      )}

      {/* CENTER PANEL */}
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
    </div>
  );
}
