import React, { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import FileExplorer from "./components/FileExplorer";
import FlowPanel from "./components/FlowPanel";

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
      <FlowPanel
        parents={parents}
        functions={functions}
        expanded={expanded}
        toggle={toggle}
      />
    </div>
  );
}
