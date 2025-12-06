// App.tsx
import React, { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import FileExplorer, { FileExplorerHandle } from "./components/FileExplorer";
import FlowPanel from "./components/FlowPanel";

export default function App() {
  const [parents, setParents] = useState<string[]>([]);
  interface FunctionData {
    body: string;
    start_line: number;
    file_path: string;
  }
  const [functions, setFunctions] = useState<Record<string, FunctionData>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const sidebarRef = useRef<HTMLDivElement>(null);
  const fileExplorerRef = useRef<FileExplorerHandle>(null);

  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  // Fetch parents and functions once
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

  // Handler for clicking a function in FlowPanel
  const handleFunctionClick = useCallback((fullId: string) => {
    let path = fullId.split("::")[0];
    if (path.startsWith("/")) path = path.slice(1);
    const repoRoot = "/home/bimal/Documents/ucsd/research/code/trap/";
    fileExplorerRef.current?.highlightFile(repoRoot + path);
  }, []);

  // Line-by-line fetch for FlowPanel
  const fetchLineEvent = useCallback(async (lineId: string, argsJson: string) => {
    try {
      const result: any = await invoke("get_next_tracer_event", {
          entryFullId: lineId,
          argsJson: argsJson,

      });

      console.log({
          entryFullId: lineId,
          argsJson: argsJson,

      })

      if (result && result.events && result.events.length > 0) {
        return result.events[0]; // Only one event per line
      }
    } catch (e) {
      console.error("Error fetching line event:", e);
    }
    return null;
  }, []);

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }}>
      {/* Sidebar */}
      <div ref={sidebarRef} style={{ width: 280, backgroundColor: "#f3f4f6", borderRight: "1px solid #e5e7eb" }}>
        <FileExplorer ref={fileExplorerRef} />
      </div>

      {/* FlowPanel */}
      <FlowPanel
        parents={parents}
        functions={functions}
        expanded={expanded}
        toggle={toggle}
        onFunctionClick={handleFunctionClick}
      />
    </div>
  );
}
