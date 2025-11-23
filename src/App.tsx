import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import FileSidebar from "./components/FileSidebar";
import FlowView from "./components/FlowView";
import type { FlowFile } from "./utils/types";

function isTauriAvailable() {
  // when running inside Tauri, window.__TAURI__ is present
  // guard to allow running the frontend with `npm run dev` without the Rust backend
  return typeof window !== 'undefined' && (window as any).__TAURI__ !== undefined;
}

function App() {
  const [repoPath, setRepoPath] = useState<string>("/home/bimal/Documents/ucsd/research/code/tauri/linearization");
  const [range, setRange] = useState<string>("HEAD~1..HEAD");
  const [flows, setFlows] = useState<FlowFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchFlows() {
    setLoading(true);
    setError(null);
    try {
      const res = await invoke("get_flows") as any;
      console.log("Fetched flows:", res);
      // Expecting an array of file entries
      setFlows(res as FlowFile[]);
      if (res && res.length > 0) {
        setSelectedFile((res[0] as FlowFile).path || null);
      }
    } catch (e: any) {
      console.error(e);
      setError(e?.toString() || "Failed to fetch flows");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // initial fetch only if Tauri is available
    fetchFlows()
        .then(() => { console.log("Initial flows fetched"); })
        .catch((e) => console.error("Error fetching initial flows:", e));
  }, []);

  return (
    <div className="h-screen flex bg-slate-50 text-slate-800">
      <aside className="w-72 border-r border-slate-200 bg-white">
        <div className="p-4 border-b">
          <h1 className="text-lg font-semibold">FlowLens</h1>
          <p className="text-xs text-slate-500">Python flow visualizer</p>
        </div>
        <div className="p-3">
          <label className="block text-xs text-slate-500">Repo Path</label>
          <input
            className="w-full mt-1 p-2 rounded border bg-slate-50 text-sm"
            value={repoPath}
            onChange={(e) => setRepoPath(e.currentTarget.value)}
          />
          <label className="block text-xs text-slate-500 mt-2">Git Range</label>
          <input
            className="w-full mt-1 p-2 rounded border bg-slate-50 text-sm"
            value={range}
            onChange={(e) => setRange(e.currentTarget.value)}
          />
          <div className="mt-3 flex gap-2">
            <button
              className="px-3 py-2 rounded bg-indigo-600 text-white text-sm shadow"
              onClick={fetchFlows}
            >
              Refresh
            </button>
            <button
              className="px-3 py-2 rounded bg-white text-sm border"
              onClick={() => { setRepoPath('.'); setRange('HEAD~1..HEAD'); }}
            >
              Reset
            </button>
          </div>
        </div>
        <FileSidebar
          files={flows}
          selectedFile={selectedFile}
          onSelectFile={(p) => setSelectedFile(p)}
        />
      </aside>

      <main className="flex-1 p-6 overflow-auto">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Flows</h2>
            <p className="text-sm text-slate-500">Showing functions changed in the provided git range</p>
          </div>
          <div className="text-sm text-slate-500">
            {loading ? "Loading…" : `${flows.length} file(s)`}
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded">{error}</div>
        )}

        <div className="mt-6">
          <FlowView files={flows} filterFile={selectedFile} />
        </div>
      </main>
    </div>
  );
}

export default App;

