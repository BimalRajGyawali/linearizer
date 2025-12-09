# Linearizer

**In-place expansion of function calls, grouped by the program's control flow.**

Linearizer is a Tauri-based desktop application that visualizes Python code execution by expanding function calls inline, organized according to the program's control flow. It helps developers understand code execution paths by showing function bodies expanded at their call sites, with interactive tracing capabilities.

## Features

- **Function Call Expansion**: Click on function calls to expand their bodies inline
- **Control Flow Visualization**: Functions are organized by their call hierarchy, showing parent functions that aren't called by others
- **Interactive Tracing**: Click on any line to trace execution and see local variables at that point
- **File Explorer**: Sidebar file tree with Git status indicators (added, modified, deleted, untracked)
- **Syntax Highlighting**: Python code is syntax-highlighted for better readability
- **Git Integration**: Automatically detects changed functions from Git diffs
- **Real-time Debugging**: Uses Python's debugger API to step through code execution

## Architecture

Linearizer is built as a **Tauri application** with:

- **Frontend**: React + TypeScript with Vite
- **Backend**: Rust (Tauri)
- **Python Tools**: Scripts for analyzing Git diffs and tracing execution


## Project Structure

```
linearizer/
├── src/                          # Frontend React application
│   ├── App.tsx                   # Main application component
│   ├── components/
│   │   ├── FileExplorer.tsx      # File tree sidebar
│   │   ├── FlowPanel.tsx         # Basic flow panel (legacy)
│   │   └── HighlightedFlowPanel.tsx  # Main flow panel with syntax highlighting
│   ├── utils/
│   │   └── types.ts              # TypeScript type definitions
│   └── main.tsx                  # React entry point
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── main.rs               # Tauri entry point
│   │   ├── lib.rs                # Main Rust logic and Tauri commands
│   │   └── tracer.rs             # (Currently minimal)
│   ├── Cargo.toml                # Rust dependencies
│   └── tauri.conf.json           # Tauri configuration
├── tools/                        # Python analysis scripts
│   ├── get_changed_functions.py  # Extracts changed functions from Git diffs
│   ├── get_file_tree.py          # Builds file tree with Git status
│   ├── get_tracer.py             # Python debugger for execution tracing
│   └── README.md                 # Tools documentation
├── package.json                  # Node.js dependencies
└── README.md                     # This file
```

## Prerequisites

- **Node.js** (v18 or later)
- **Rust** (latest stable)
- **Python 3.8+** (for analysis tools)
- **Git** (for detecting changed functions)
- **Tauri CLI** (installed via npm)

## Installation

1. **Clone the repository** (if applicable):
   ```bash
   git clone <repository-url>
   cd linearizer
   ```

2. **Install Node.js dependencies**:
   ```bash
   npm install
   ```

3. **Install Tauri CLI** (if not already installed):
   ```bash
   npm install -g @tauri-apps/cli
   ```

4. **Configure Python path** (optional):
   ```bash
   export PYTHON_BIN=python3  # or python, depending on your system
   ```

5. **Update repository path** (if needed):
   - Edit `src-tauri/src/lib.rs` and update the `repo` variable (currently hardcoded to `/home/bimal/Documents/ucsd/research/code/trap`)
   - Edit `src/App.tsx` and update the `repoRoot` variable (line 104)

## Usage

Run the application in development mode:

```bash
npm run tauri dev
```

## How It Works

### 1. Function Detection

The application uses `tools/get_changed_functions.py` to:
- Analyze Git diffs to find changed Python functions
- Extract function bodies with qualified call names (e.g., `/path/to/file.py::function_name`)
- Build a call graph showing which functions call which
- Identify "parent" functions (functions not called by others)

### 2. Function Qualification

Function calls in code are qualified with their file paths:
- Local functions: `/current/file.py::function_name`
- Imported functions: Resolved based on import statements
- This allows the UI to show exactly which function is being called

### 3. Interactive Expansion

- Click on a parent function header to expand its body
- Click on function calls within bodies to expand those functions inline
- Each expansion is nested and indented to show the call hierarchy
- Click again to collapse

### 4. Execution Tracing

When you click on a line of code:
- The Rust backend spawns a Python debugger process (`get_tracer.py`)
- The debugger runs the function and stops at the clicked line
- Local variables and execution state are captured and displayed
- You can continue stepping by clicking other lines

### 5. File Navigation

- The sidebar shows the repository file tree
- Git status is indicated with colors
- Clicking a function call highlights the corresponding file in the explorer


### Python Tools

**`get_changed_functions.py`**:
- Parses Git diffs to find changed functions
- Extracts function bodies and qualifies function calls
- Builds call graphs and identifies parent functions
- Saves results to `functions.json`, `call_graph.json`, and `parent_functions.json`

**`get_file_tree.py`**:
- Builds a JSON tree of repository files
- Includes Git status for each file

**`get_tracer.py`**:
- Uses Python's `bdb` debugger to trace execution
- Communicates via stdin/stdout with the Rust backend
- Captures local variables and execution state at each line

## Configuration

### Repository Path

Currently, the repository path is hardcoded in several places:
- `src-tauri/src/lib.rs`: Line 20 (for Python scripts)
- `src/App.tsx`: Line 104 (for file highlighting)

To change the repository:
1. Update these paths in the source code
2. Or set environment variables (requires code changes to use them)

### Python Binary

Set the `PYTHON_BIN` environment variable to specify which Python to use:
```bash
export PYTHON_BIN=python3
```

---

**Note**: This is a research tool for code analysis and visualization. The codebase includes hardcoded paths that should be made configurable for general use.
