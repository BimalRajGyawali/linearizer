export interface FlowNode {
  qualname: string;
  name: string;
  filepath: string;
  lineno: number;
  changed_lines?: number[];
  source_snippet?: string;
}

export interface FlowFile {
  path: string;
  status: string;
  flows: {
    path: string[];
    nodes: FlowNode[];
  }[];
}

