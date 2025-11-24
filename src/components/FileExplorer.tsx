import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function FileExplorer() {
  const [tree, setTree] = useState(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    invoke("get_file_tree").then((t) => setTree(t));
  }, []);

  const toggle = (path) => {
    setOpen((p) => ({ ...p, [path]: !p[path] }));
  };

  const renderNode = (node, depth = 0) => {
    if (!node) return null;

    const isFolder = node.type === "folder";
    const isOpen = open[node.path] || false;

    return (
      <div key={node.path} style={{ marginLeft: depth * 12 }}>
        <div
          onClick={() => isFolder && toggle(node.path)}
          style={{
            cursor: isFolder ? "pointer" : "default",
            fontWeight: isFolder ? 600 : 400,
            fontFamily: "Fira Code, monospace",
            padding: "2px 0"
          }}
        >
          {isFolder ? (isOpen ? "📂 " : "📁 ") : "📄 "}
          {node.name}
        </div>

        {isFolder && isOpen && node.children?.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div>
      <h2 className="font-bold mb-2 text-sm">Files</h2>
      {tree ? renderNode(tree) : <div>Loading...</div>}
    </div>
  );
}
