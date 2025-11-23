import React from "react";
import type { FlowFile } from "../utils/types";

interface Props {
  files: FlowFile[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}

export default function FileSidebar({ files, selectedFile, onSelectFile }: Props) {
  return (
    <div className="p-3 overflow-auto" style={{ height: 'calc(100vh - 220px)' }}>
      <div className="text-xs text-slate-500 mb-2">Changed files</div>
      <ul className="space-y-2">
        {files.map((f) => (
          <li key={f.path}>
            <button
              onClick={() => onSelectFile(f.path)}
              className={`w-full text-left p-2 rounded hover:bg-slate-50 flex items-center justify-between ${selectedFile === f.path ? 'bg-indigo-50 border border-indigo-100' : ''}`}
            >
              <div>
                <div className="text-sm font-medium">{f.path}</div>
                <div className="text-xs text-slate-400">{(f.flows || []).length} flow(s)</div>
              </div>
              <div className="text-xs text-slate-500">{f.status}</div>
            </button>
          </li>
        ))}
        {files.length === 0 && (
          <li className="text-sm text-slate-400">No changed Python files found in range.</li>
        )}
      </ul>
    </div>
  );
}

