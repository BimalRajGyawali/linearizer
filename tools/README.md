FlowLens tools
===============

get_changed_functions.py
------------------------
A small Python script that inspects git diffs and extracts changed Python functions.

Usage:

```bash
python3 tools/get_changed_functions.py --repo . --range HEAD~1..HEAD
# or inspect staged changes
python3 tools/get_changed_functions.py --repo . --staged
```

JSON output format (prototype):

[
  {
    "path": "path/to/file.py",
    "status": "M",
    "flows": [
      {
        "path": ["func1", "func2"],
        "nodes": [ {"qualname": "func1", "name": "func1", "filepath": "path/to/file.py", "lineno": 12, "changed_lines": [12,13], "source_snippet": "def func1(...):\n  ..." }, ... ]
      }
    ]
  }
]

Notes:
- The tool uses `git -C <repo> diff` under the hood. Ensure your repo is valid.
- Requires Python 3.8+ for accurate `end_lineno` on AST nodes.
- This is a prototype; treat the output schema as subject to change.

