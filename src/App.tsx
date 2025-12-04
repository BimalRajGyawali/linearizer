// App.tsx
import React, { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import FileExplorer, { FileExplorerHandle } from "./components/FileExplorer";
import FlowPanel from "./components/HighlightedFlowPanel";

export default function App() {
  const [parents, setParents] = useState<string[]>([]);
  interface FunctionData {
    body: string;
    start_line: number;
    file_path: string;
  }
  const [functions, setFunctions] = useState<Record<string, FunctionData>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Sidebar width and dragging
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [collapsed, setCollapsed] = useState(false);
  const lastSidebarWidth = useRef(sidebarWidth);
  const [draggingOverlay, setDraggingOverlay] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const COLLAPSED_WIDTH = 40; // Minimum clickable width

  // FileExplorer ref to control scrolling/highlighting
  const fileExplorerRef = useRef<FileExplorerHandle>(null);

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

  // When a function call is clicked inside FlowPanel
  const handleFunctionClick = useCallback((fullId: string) => {
    // extract file path before ::
    let path = fullId.split("::")[0]; // "/backend/services/analytics_processor.py"

    // Remove leading slash if your FileNode paths are relative to repo root
    if (path.startsWith("/")) path = path.slice(1);

    // Optional: prepend repo root if needed
    const repoRoot = "/home/bimal/Documents/ucsd/research/code/trap/";
    const fullPath = repoRoot + path;

    fileExplorerRef.current?.highlightFile(fullPath);
  }, []);
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
            <FileExplorer ref={fileExplorerRef} />
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
      {/* CENTER PANEL */}
      <FlowPanel
        parents={parents}
        functions={functions}
        expanded={expanded}
        toggle={toggle}
        onFunctionClick={handleFunctionClick} // pass handler to FlowPanel
        traceEvents={[
          {
            "event": "line",
            "filename": "/home/bimal/Documents/ucsd/research/code/trap/backend/services/analytics.py",
            "function": "get_metric_time_based_stats",
            "line": 80,
            "locals": {
              "metric_name": "test",
              "window_size": "daily"
            }
          },
          {
            "event": "line",
            "filename": "/home/bimal/Documents/ucsd/research/code/trap/backend/services/analytics_processor.py",
            "function": "process_time_based_stats",
            "line": 85,
            "locals": {
              "metric_name": "test",
              "window_size": "daily"
            }
          },
          {
            "event": "line",
            "filename": "/home/bimal/Documents/ucsd/research/code/trap/backend/services/analytics_storage.py",
            "function": "get_metric_values_with_timestamps",
            "line": 53,
            "locals": {
              "metric_name": "test"
            }
          },
          {
            "event": "return",
            "filename": "/home/bimal/Documents/ucsd/research/code/trap/backend/services/analytics_storage.py",
            "function": "get_metric_values_with_timestamps",
            "value": []
          },
          {
            "event": "line",
            "filename": "/home/bimal/Documents/ucsd/research/code/trap/backend/services/analytics_processor.py",
            "function": "process_time_based_stats",
            "line": 88,
            "locals": {
              "metric_name": "test",
              "window_size": "daily",
              "metric_data": []
            }
          },
          {
            "event": "line",
            "filename": "/home/bimal/Documents/ucsd/research/code/trap/backend/services/analytics_aggregator.py",
            "function": "aggregate_metric_stats_by_time_window",
            "line": 50,
            "locals": {
              "metric_name": "test",
              "metric_data": [],
              "window_size": "daily"
            }
          },
          {
            "event": "line",
            "filename": "/home/bimal/Documents/ucsd/research/code/trap/backend/services/analytics_aggregator.py",
            "function": "aggregate_metric_stats_by_time_window",
            "line": 51,
            "locals": {
              "metric_name": "test",
              "metric_data": [],
              "window_size": "daily"
            }
          },
          {
            "event": "return",
            "filename": "/home/bimal/Documents/ucsd/research/code/trap/backend/services/analytics_aggregator.py",
            "function": "aggregate_metric_stats_by_time_window",
            "value": null
          },
          {
            "event": "return",
            "filename": "/home/bimal/Documents/ucsd/research/code/trap/backend/services/analytics_processor.py",
            "function": "process_time_based_stats",
            "value": null
          },
          {
            "event": "return",
            "filename": "/home/bimal/Documents/ucsd/research/code/trap/backend/services/analytics.py",
            "function": "get_metric_time_based_stats",
            "value": null
          },
          {
            "event": "done",
            "filename": "",
            "function": "",
            "line": 0,
            "result": null
          }
        ]}
      />
    </div>
  );
}