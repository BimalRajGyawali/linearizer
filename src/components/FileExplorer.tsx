import React, { useEffect, useState, forwardRef, useImperativeHandle, Ref } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FiFolder, FiFolderPlus, FiFile } from "react-icons/fi";

export type FileNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
  git?: "added" | "modified" | "deleted" | "untracked" | null;
};

export type FileExplorerHandle = {
  highlightFile: (path: string) => void;
};

const FileExplorer = forwardRef((props, ref: Ref<FileExplorerHandle>) => {
  const [tree, setTree] = useState<FileNode | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke("get_file_tree").then((t) => setTree(t as FileNode));
  }, []);

  const toggle = (path: string) => setOpen((o) => ({ ...o, [path]: !o[path] }));

  const gitColor = (status?: string) => {
    switch (status) {
      case "added": return "#16a34a";
      case "modified": return "#ca8a04";
      case "deleted": return "#dc2626";
      case "untracked": return "#6b7280";
      default: return "#111";
    }
  };

useImperativeHandle(ref, () => ({
  highlightFile: (path: string) => {
    // Expand all parent folders
    const openMap: Record<string, boolean> = {};
    const expandParents = (node: FileNode | undefined) => {
      if (!node) return false;
      if (node.path === path) return true;
      if (node.children) {
        for (const c of node.children) {
          if (expandParents(c)) {
            openMap[node.path] = true;
            return true;
          }
        }
      }
      return false;
    };
    expandParents(tree!);

    // Merge with existing open state
    setOpen((prev) => ({ ...prev, ...openMap }));

    setHighlighted(path);

    console.log(path)

    // Scroll to element
    const el = document.getElementById(`file-${path}`);
    if (el && containerRef.current) {
      const container = containerRef.current;
      const elTop = el.offsetTop;
      const elBottom = elTop + el.offsetHeight;
      const containerTop = container.scrollTop;
      const containerBottom = containerTop + container.clientHeight;

      if (elTop < containerTop) {
        container.scrollTop = elTop - 8; // scroll up slightly
      } else if (elBottom > containerBottom) {
        container.scrollTop = elBottom - container.clientHeight + 8; // scroll down slightly
      }
    }
  },
}));

  const renderNode = (node: FileNode, depth = 0) => {
    const isFolder = node.type === "folder";
    const isOpen = open[node.path] || false;
    const isHighlighted = highlighted === node.path;

    console.log(node.path)

    return (
      <div key={node.path} style={{ marginLeft: depth * 14, fontFamily: "Fira Code, monospace" }}>
        <div
          id={`file-${node.path}`}
          style={{
            display: "flex",
            alignItems: "center",
            cursor: isFolder ? "pointer" : "default",
            fontWeight: isFolder ? 600 : 400,
            fontSize: 13,
            lineHeight: "1.5rem",
            padding: "4px 6px",
            color: gitColor(node.git),
            backgroundColor: isHighlighted ? "rgba(156, 163, 175, 0.1)" : "transparent", // subtle gray overlay
            borderLeft: isHighlighted ? "3px solid #3b82f6" : "3px solid transparent", // soft accent
            borderRadius: 4,
            boxShadow: isHighlighted ? "inset 0 0 2px rgba(0,0,0,0.05)" : "none", // very subtle depth
            transition: "background-color 0.2s, border-left 0.2s",
          }}
          onClick={() => isFolder && toggle(node.path)}
        >
          <span style={{ marginRight: 6 }}>
            {isFolder ? (isOpen ? <FiFolderPlus /> : <FiFolder />) : <FiFile />}
          </span>
          <span>{node.name}</span>
        </div>

        {isFolder && isOpen && node.children?.map((c) => renderNode(c, depth + 1))}
      </div>
    );



  };

  return (
    <div ref={containerRef} style={{ overflowY: "auto", height: "100%", padding: 8 }}>
      {tree ? renderNode(tree) : "Loading..."}
    </div>
  );
});

export default FileExplorer;
