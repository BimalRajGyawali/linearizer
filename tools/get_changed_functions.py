import argparse
import ast
import json
import re
import subprocess
import sys
from pathlib import Path
from textwrap import indent
from typing import Dict, List, Optional, Tuple


def run_git_diff(repo: str) -> Tuple[int, str, str]:
    cmd = [
        "git",
        "-C",
        repo,
        "diff",
        "--relative",
        "--ignore-space-at-eol",
        "-b",
        "-w",
        "--ignore-blank-lines"
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return proc.returncode, proc.stdout, proc.stderr

import re

PY_FUNC_DEF = re.compile(r"^\s*def\s+([A-Za-z_]\w*)\s*\(")

import difflib
import re

# reuse your PY_FUNC_DEF
# PY_FUNC_DEF = re.compile(r"^\s*def\s+([A-Za-z_]\w*)\s*\(")

CALL_RE = re.compile(r"[A-Za-z_]\w*\s*\(")
DEF_LINE_RE = re.compile(r"^\s*def\s+[A-Za-z_]\w*\s*\((.*)\)\s*(?:->\s*(.*))?:\s*$")

def _strip_type_annotations_from_params(params_text: str) -> str:
    """
    Remove simple type annotations inside the param list.
    Example: 'a: int, b: Optional[str] = None' -> 'a, b = None'
    It's conservative — leaves default values but removes ': type' pieces.
    """
    # Remove `: <something>` occurrences that are not inside quotes or parentheses parsing
    # This is simple regex-based removal (good for common cases).
    # It will replace ": <anything up to comma or = or )" with "".
    res = re.sub(r"\s*:\s*[^,=\)\]]+", "", params_text)
    # Normalize whitespace
    res = re.sub(r"\s+", " ", res).strip()
    return res

def _normalize_def_line(line: str) -> Optional[str]:
    """
    Return a normalized representation of a def line with annotations removed.
    If the line is not a def line, return None.
    """
    m = DEF_LINE_RE.match(line)
    if not m:
        return None
    params_text = m.group(1) or ""
    # remove annotations from params
    params_no_ann = _strip_type_annotations_from_params(params_text)
    # ignore return annotation entirely
    # produce normalized: "def name(params_no_ann)"
    # We also keep function name to ensure it's the same; extract name:
    name_m = re.match(r"^\s*def\s+([A-Za-z_]\w*)\s*\(", line)
    name = name_m.group(1) if name_m else ""
    return f"def {name}({params_no_ann})"

def _def_line_change_is_trivial(removed: str, added: str) -> bool:
    """
    Determine if a def-line change is trivial:
    - normalize both lines (strip annotations)
    - if normalized forms are identical -> trivial (only annotations/return changed)
    - otherwise, compute a small token change tolerance:
        - if Levenshtein-like ratio is very high (e.g., difflib.SequenceMatcher ratio >= 0.85),
          treat as trivial (small rename or tiny edits).
    """
    norm_removed = _normalize_def_line(removed)
    norm_added = _normalize_def_line(added)

    # If either is not a def-line, it's not a def-def change
    if norm_removed is None or norm_added is None:
        return False

    if norm_removed == norm_added:
        return True

    # Fallback: allow very small changes (e.g., one-word rename in param name)
    ratio = difflib.SequenceMatcher(None, norm_removed, norm_added).ratio()
    return ratio >= 0.85


def is_important_hunk(hunk_lines: List[str]) -> bool:
    """
    Improved hunk importance check:
    - Collect added and removed lines (ignore '+++' file header lines).
    - If there are multiple non-trivial changes -> important.
    - If only one changed line:
        - keep if it contains a function call
        - if it's a def-line change but _trivial_ (only annotations/return changed) -> ignore
        - else keep
    - If multiple changed lines but they are all trivial defs / trivial imports, you can choose
      to ignore them — here we still treat multiple changes as important unless all are trivial.
    """

    added = [l for l in hunk_lines if l.startswith("+") and not l.startswith("+++")]
    removed = [l for l in hunk_lines if l.startswith("-") and not l.startswith("---")]

    # Quick exit: no added lines -> ignore
    if not added and not removed:
        return False

    # If single-line change overall (one added and/or one removed)
    total_changed_count = len(added) + len(removed)
    if total_changed_count == 1:
        # Single added line
        line = (added[0] if added else removed[0])[1:]
        # Def-line? ignore if trivial
        if PY_FUNC_DEF.match(line):
            # There's no opposite line to compare; treat as trivial (definition formatting etc.)
            return False
        # Keep if call found
        if CALL_RE.search(line):
            return True
        return False

    # If there are paired def lines (removed + added) which indicate a def signature change,
    # attempt to detect trivial def->def changes.
    # Find pairs where both removed and added are def-lines for the same function name.
    trivial_pairs = 0
    def_pairs_checked = 0
    for r in removed:
        r_line = r[1:]
        if not PY_FUNC_DEF.match(r_line):
            continue
        # try to find a corresponding added def line with same function name
        r_name_m = PY_FUNC_DEF.match(r_line)
        r_name = r_name_m.group(1)
        for a in added:
            a_line = a[1:]
            a_name_m = PY_FUNC_DEF.match(a_line)
            if not a_name_m:
                continue
            a_name = a_name_m.group(1)
            if a_name == r_name:
                def_pairs_checked += 1
                if _def_line_change_is_trivial(r_line, a_line):
                    trivial_pairs += 1

    # If all changed lines are just trivial def->def changes (and there are no other added non-def lines),
    # then we can ignore the hunk.
    # Count non-def added lines that are not just import/comment/whitespace
    non_def_added = []
    for a in added:
        a_line = a[1:].strip()
        if not a_line:
            continue
        if PY_FUNC_DEF.match(a_line):
            continue
        # allow import additions to be considered "minor" (optional: treat imports as trivial)
        if a_line.startswith("from ") or a_line.startswith("import "):
            # treat import additions as minor — do not add to non_def_added
            continue
        # comments or simple #: skip
        if a_line.startswith("#"):
            continue
        non_def_added.append(a_line)

    # If every def pair we found is trivial, and there are no other meaningful added lines, treat hunk as unimportant
    if def_pairs_checked > 0 and def_pairs_checked == trivial_pairs and len(non_def_added) == 0:
        return False

    # Otherwise, keep the hunk if:
    # - there exists any added line that contains a call
    for a in added:
        if CALL_RE.search(a[1:]):
            return True

    # If many lines changed and none of the above heuristics flagged it trivial, treat as important.
    return True


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
            # start a new hunk section
            current["hunks"].append({"header": line, "lines": []})

        elif current and current["hunks"]:
            # add lines to the current hunk
            current["hunks"][-1]["lines"].append(line)

    if current:
        files.append(current)

    # --------- FILTER HUNKS HERE ----------
    # keep only important hunks (1-line call changes OR multi-line changes)
    filtered_files = []
    for f in files:
        important_hunks = [
            h for h in f["hunks"]
            if is_important_hunk(h["lines"])
        ]
        if important_hunks:
            f["hunks"] = important_hunks
            filtered_files.append(f)

    return filtered_files



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


from pathlib import Path

def save_function(path: str, name: str, body: str, file_path: str = "functions.json"):
    """
    Save a function body into a JSON file under the key 'path.name'.
    If the JSON file exists, it is loaded and updated. Otherwise, created fresh.
    """

    key = f"{name}"
    json_path = Path(file_path)

    # Load existing JSON or start empty
    if json_path.exists():
        try:
            with json_path.open("r") as f:
                data = json.load(f)
        except json.JSONDecodeError:
            data = {}
    else:
        data = {}

    # Update entry
    data[key] = body

    # Write back
    with json_path.open("w") as f:
        json.dump(data, f, indent=2)


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
                results[f"{current_name}"] = "\n".join(current_body)
                save_function(path, current_name, "\n".join(current_body))

            current_name = name if name in function_names else None
            current_body = [line] if current_name else []

        elif current_name:
            # part of the function body
            current_body.append(line)

    if current_name:
        results[f"{current_name}"] = "\n".join(current_body)
        save_function(path, current_name, "\n".join(current_body))

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
        return list(found)

    for n in ast.walk(node):
        if isinstance(n, ast.Call):
            if isinstance(n.func, ast.Name):
                found.add(n.func.id)
            elif isinstance(n.func, ast.Attribute):
                found.add(n.func.attr)
    return list(found)


def save_graph(graph: Dict[str, List[str]], file_path: str = "call_graph.json"):
    """
    Save a call graph (dict of str → list[str]) as formatted JSON.
    Overwrites the file each time to keep it valid.
    """
    path = Path(file_path)

    with path.open("w") as f:
        json.dump(graph, f, indent=2)


def build_changed_call_graph(function_bodies: Dict[str,str]) -> Dict[str,List[str]]:
    changed_names = set(function_bodies.keys())
    graph = {}
    for fn, body in function_bodies.items():
        calls = find_calls_ast(body)
        graph[fn] = calls # [c for c in calls if c in changed_names]

    # save_graph(graph, "call_graph.json")

    return graph



def save_parent_functions(parents: List[str], file_path: str = "parent_functions.json"):
    """
    Save the list of top-level parent functions to a JSON file.
    Overwrites the file each time.
    """
    path = Path(file_path)
    with path.open("w") as f:
        json.dump(parents, f, indent=2)


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
    save_parent_functions(list(parents), "parent_functions.json")
    return list(parents)


# def build_flows(repo):
#     print(f"Building flows for {repo}...")
#     res = run_git_diff(repo)
#     content = parse_diff(res[1])
#     changed_funcs = find_changed_functions(content)
#     all_func_bodies = {}
#     for file, funcs in changed_funcs.items():
#         func_bodies = extract_functions_from_file(repo + "/" + file, funcs)
#         all_func_bodies.update(func_bodies)
#
#     call_graph = build_changed_call_graph(all_func_bodies)
#     parent_funcs = find_parent_functions_changed_only(call_graph)
#
#     return parent_funcs


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

        print(json.dumps({"parents": parent_funcs}, indent=2), file=sys.stdout)
    except Exception as e:

        print(json.dumps({"error": str(e)}), file=sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
