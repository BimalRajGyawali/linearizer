import argparse
import ast
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple


def run_git_diff(repo: str) -> Tuple[int, str, str]:
    print("Running git diff...")
    cmd = ["git", "-C", repo, "diff", "--relative"]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return proc.returncode, proc.stdout, proc.stderr

def parse_diff(diff_text: str):
    files = []
    current = None

    for line in diff_text.splitlines():
        if line.startswith("diff --git"):
            if current:
                files.append(current)
            current = {"file": None, "hunks": []}

        elif line.startswith("+++ b/"):
            if current:
                current["file"] = line.replace("+++ b/", "").strip()

        elif line.startswith("@@"):
            current["hunks"].append({"header": line, "lines": []})

        elif current and current["hunks"]:
            current["hunks"][-1]["lines"].append(line)

    if current:
        files.append(current)

    return files


import re

PY_FUNC_DEF = re.compile(r"^\s*def\s+([A-Za-z_]\w*)\s*\(")

def find_changed_functions(parsed_files):
    changed = {}   # file -> set of function names

    for f in parsed_files:
        file_path = f["file"]
        funcs = set()

        for h in f["hunks"]:
            for line in h["lines"]:
                if line.startswith(("+", " ")):  # added or context
                    stripped = line[1:]
                    m = PY_FUNC_DEF.match(stripped)
                    if m:
                        funcs.add(m.group(1))

        if funcs:
            changed[file_path] = funcs

    return changed


def extract_functions_from_file(path: str, function_names: set):
    text = Path(path).read_text().splitlines()
    results = {}
    current_name = None
    current_body = []

    for i, line in enumerate(text):
        m = PY_FUNC_DEF.match(line)
        if m:
            name = m.group(1)
            if current_name and current_body:
                results[current_name] = "\n".join(current_body)

            current_name = name if name in function_names else None
            current_body = [line] if current_name else []

        elif current_name:
            # part of the function body
            current_body.append(line)

    if current_name:
        results[current_name] = "\n".join(current_body)

    return results


def find_calls_ast(body: str) -> List[str]:
    """
    Parse function body using AST and return names of all called functions.
    Ignores the function's own def line.
    """
    found = set()
    # lines = body.splitlines()[1:]  # skip def line
    code = body #"\n".join(lines)

    try:
        node = ast.parse(code)
    except SyntaxError:
        print("error")
        return list(found)

    for n in ast.walk(node):
        if isinstance(n, ast.Call):
            if isinstance(n.func, ast.Name):
                found.add(n.func.id)
            elif isinstance(n.func, ast.Attribute):
                found.add(n.func.attr)
    return list(found)


def build_changed_call_graph(function_bodies: Dict[str,str]) -> Dict[str,List[str]]:
    changed_names = set(function_bodies.keys())
    graph = {}
    for fn, body in function_bodies.items():
        calls = find_calls_ast(body)
        # only keep calls to other changed functions
        graph[fn] = calls # [c for c in calls if c in changed_names]
    return graph


def find_parent_functions_changed_only(graph: Dict[str,List[str]]) -> List[str]:
    """
    Returns changed functions that are not called by any other changed function.
    Ignores calls to external functions.
    """
    all_funcs = set(graph.keys())
    called_by_changed = set()

    for fn, calls in graph.items():
        for c in calls:
            if c in all_funcs:
                called_by_changed.add(c)

    parents = all_funcs - called_by_changed
    return list(parents)

def build_flows(repo):
    print(f"Building flows for {repo}...")
    pass


def main(argv: Optional[List[str]] = None):
    p = argparse.ArgumentParser()
    p.add_argument("--repo", default="/home/bimal/Documents/ucsd/research/code/trap")
    args = p.parse_args(argv)

    try:
        res = run_git_diff(args.repo)
        content = parse_diff(res[1])
        changed_funcs = find_changed_functions(content)
        all_func_bodies = {}
        for file, funcs in changed_funcs.items():
            func_bodies = extract_functions_from_file(args.repo + "/" + file, funcs)
            all_func_bodies.update(func_bodies)

        call_graph = build_changed_call_graph(all_func_bodies)
        parent_funcs = find_parent_functions_changed_only(call_graph)
        print(parent_funcs)
    except Exception as e:

        print(json.dumps({"error": str(e)}), file=sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
