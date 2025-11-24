import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FiFolder, FiFolderPlus, FiFile } from "react-icons/fi";

type FileNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
  git?: "added" | "modified" | "deleted" | "untracked" | null;
};

export default function FileExplorer() {
  const [tree, setTree] = useState<FileNode | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    invoke("get_file_tree").then((t) => setTree(t as FileNode));
  }, []);

  const toggle = (path: string) => setOpen((o) => ({ ...o, [path]: !o[path] }));

  const gitColor = (status?: string) => {
    switch (status) {
      case "added":
        return "#16a34a"; // green
      case "modified":
        return "#ca8a04"; // orange/yellow
      case "deleted":
        return "#dc2626"; // red
      case "untracked":
        return "#6b7280"; // gray
      default:
        return "#111"; // default file/folder color
    }
  };

  const renderNode = (node: FileNode, depth = 0) => {
    const isFolder = node.type === "folder";
    const isOpen = open[node.path] || false;

    return (
      <div key={node.path} style={{ marginLeft: depth * 14, fontFamily: "Fira Code, monospace" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            cursor: isFolder ? "pointer" : "default",
            fontWeight: isFolder ? 600 : 400,
            fontSize: 13,
            lineHeight: "1.5rem",
            padding: "2px 0",
            color: gitColor(node.git),
          }}
          onClick={() => isFolder && toggle(node.path)}
        >
          {/* Folder/File icon */}
          <span style={{ marginRight: 6 }}>
            {isFolder ? (isOpen ? <FiFolderPlus /> : <FiFolder />) : <FiFile />}
          </span>

          {/* File/Folder name */}
          <span>{node.name}</span>
        </div>

        {/* Recursively render children */}
        {isFolder && isOpen && node.children?.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div style={{ overflowY: "auto", maxHeight: "100%", padding: 8 }}>
      {tree ? renderNode(tree) : "Loading..."}
    </div>
  );
}
