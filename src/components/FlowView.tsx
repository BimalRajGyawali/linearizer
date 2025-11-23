import React, { useState } from "react";
import type { FlowFile } from "../utils/types";

interface Props {
  files: FlowFile[];
  filterFile?: string | null;
}

export default function FlowView({ files, filterFile }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  function toggle(nodeId: string) {
    setExpanded((s) => ({ ...s, [nodeId]: !s[nodeId] }));
  }

  const visible = filterFile ? files.filter((f) => f.path === filterFile) : files;

  return (
    <div className="space-y-6">
      {visible.map((file) => (
        <div key={file.path} className="bg-white shadow-sm rounded border">
          <div className="p-3 border-b flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{file.path}</div>
              <div className="text-xs text-slate-400">{file.status}</div>
            </div>
            <div className="text-xs text-slate-400">{(file.flows || []).length} flow(s)</div>
          </div>

          <div className="p-3">
            {(file.flows || []).map((flow, fi) => (
              <div key={fi} className="space-y-3">
                <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
                  {flow.nodes.map((node) => {
                    const id = `${file.path}:${node.qualname}:${node.lineno}`;
                    const isOpen = expanded[id];
                    return (
                      <div key={id} className="flex-1">
                        <div className="border rounded p-3 bg-slate-50">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-sm font-semibold">{node.name}</div>
                              <div className="text-xs text-slate-500">{file.path}:{node.lineno}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                className="px-2 py-1 text-xs border rounded bg-white"
                                onClick={() => toggle(id)}
                              >
                                {isOpen ? "Collapse" : "Expand"}
                              </button>
                            </div>
                          </div>

                          <div className={`overflow-hidden transition-all duration-300 ${isOpen ? 'max-h-96 mt-3' : 'max-h-0'}`}>
                            {isOpen && (
                              <div className="mt-2">
                                <pre className="bg-slate-900 text-white p-3 rounded text-sm overflow-auto whitespace-pre-wrap">
{node.source_snippet}
                                </pre>
                                <div className="text-xs text-slate-400 mt-2">Changed lines: {node.changed_lines?.join(", ")}</div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {(!file.flows || file.flows.length === 0) && (
              <div className="p-4 text-sm text-slate-500">No changed functions detected in this file.</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
