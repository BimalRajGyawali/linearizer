#!/usr/bin/env python3
import argparse
import ast
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from textwrap import indent
from typing import Dict, List, Optional, Tuple, Set

# ----------------- basic utils & regex ----------------- #
PY_FUNC_DEF = re.compile(r"^\s*def\s+([A-Za-z_]\w*)\s*\(")
CALL_RE = re.compile(r"[A-Za-z_]\w*\s*\(")
DEF_LINE_RE = re.compile(r"^\s*def\s+[A-Za-z_]\w*\s*\((.*)\)\s*(?:->\s*(.*))?:\s*$")


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
        "--ignore-blank-lines",
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return proc.returncode, proc.stdout, proc.stderr


# ----------------- diff parsing & hunk heuristics ----------------- #
import difflib


def _strip_type_annotations_from_params(params_text: str) -> str:
    res = re.sub(r"\s*:\s*[^,=\)\]]+", "", params_text)
    res = re.sub(r"\s+", " ", res).strip()
    return res


def _normalize_def_line(line: str) -> Optional[str]:
    m = DEF_LINE_RE.match(line)
    if not m:
        return None
    params_text = m.group(1) or ""
    params_no_ann = _strip_type_annotations_from_params(params_text)
    name_m = re.match(r"^\s*def\s+([A-Za-z_]\w*)\s*\(", line)
    name = name_m.group(1) if name_m else ""
    return f"def {name}({params_no_ann})"


def _def_line_change_is_trivial(removed: str, added: str) -> bool:
    norm_removed = _normalize_def_line(removed)
    norm_added = _normalize_def_line(added)
    if norm_removed is None or norm_added is None:
        return False
    if norm_removed == norm_added:
        return True
    ratio = difflib.SequenceMatcher(None, norm_removed, norm_added).ratio()
    return ratio >= 0.85


def is_important_hunk(hunk_lines: List[str]) -> bool:
    added = [l for l in hunk_lines if l.startswith("+") and not l.startswith("+++")]
    removed = [l for l in hunk_lines if l.startswith("-") and not l.startswith("---")]
    if not added and not removed:
        return False
    total_changed_count = len(added) + len(removed)
    if total_changed_count == 1:
        line = (added[0] if added else removed[0])[1:]
        if PY_FUNC_DEF.match(line):
            return False
        if CALL_RE.search(line):
            return True
        return False

    trivial_pairs = 0
    def_pairs_checked = 0
    for r in removed:
        r_line = r[1:]
        if not PY_FUNC_DEF.match(r_line):
            continue
        r_name = PY_FUNC_DEF.match(r_line).group(1)
        for a in added:
            a_line = a[1:]
            if not PY_FUNC_DEF.match(a_line):
                continue
            a_name = PY_FUNC_DEF.match(a_line).group(1)
            if a_name == r_name:
                def_pairs_checked += 1
                if _def_line_change_is_trivial(r_line, a_line):
                    trivial_pairs += 1

    non_def_added = []
    for a in added:
        a_line = a[1:].strip()
        if not a_line:
            continue
        if PY_FUNC_DEF.match(a_line):
            continue
        if a_line.startswith("from ") or a_line.startswith("import "):
            continue
        if a_line.startswith("#"):
            continue
        non_def_added.append(a_line)

    if def_pairs_checked > 0 and def_pairs_checked == trivial_pairs and len(non_def_added) == 0:
        return False

    for a in added:
        if CALL_RE.search(a[1:]):
            return True

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
            if current is None:
                continue
            current["hunks"].append({"header": line, "lines": []})
        elif current and current["hunks"]:
            current["hunks"][-1]["lines"].append(line)
    if current:
        files.append(current)

    filtered_files = []
    for f in files:
        important_hunks = [h for h in f["hunks"] if is_important_hunk(h["lines"])]
        if important_hunks:
            f["hunks"] = important_hunks
            filtered_files.append(f)

    return filtered_files


def find_changed_functions(parsed_files):
    changed = {}
    for f in parsed_files:
        file_path = f["file"]
        funcs: Set[str] = set()
        for h in f["hunks"]:
            for line in h["lines"]:
                if line.startswith(("+", " ")):
                    stripped = line[1:]
                    m = PY_FUNC_DEF.match(stripped)
                    if m:
                        funcs.add(m.group(1))
        if funcs:
            changed[file_path] = funcs
    return changed


# ----------------- utilities for canonical ids ----------------- #
def rel_path(repo_root: str, abs_path: str) -> str:
    try:
        return os.path.relpath(abs_path, repo_root).replace("\\", "/")
    except Exception:
        return abs_path.replace("\\", "/")


def make_full_id(rel_file: str, fn_name: str) -> str:
    return f"{rel_file}::{fn_name}"


# ----------------- function extraction & saving ----------------- #
def save_function(path: str, name: str, body: str, repo_root: Optional[str] = None):
    """
    Save a function body into a JSON file under the key '<rel_path>::name'.
    data[key] = {"file": "<rel/path.py>", "body": "<source>"}
    """
    file_path: str = "functions.json"
    json_path = Path(file_path)
    if json_path.exists():
        try:
            with json_path.open("r") as f:
                data = json.load(f)
        except json.JSONDecodeError:
            data = {}
    else:
        data = {}

    rel = path
    if repo_root:
        try:
            rel = os.path.relpath(path, repo_root)
        except Exception:
            rel = path

    rel = rel.replace("\\", "/")
    key = f"/{make_full_id(rel, name)}"
    data[key] = body

    with json_path.open("w") as f:
        json.dump(data, f, indent=2)


def parse_imports(path: str) -> Dict[str, str]:
    """
    Parse imports in a file and return mapping: alias -> full module path.
    """
    import_map = {}
    text = Path(path).read_text().splitlines()
    for line in text:
        line = line.strip()
        if line.startswith("import "):
            # import module as alias
            parts = line.replace("import ", "").split(" as ")
            module = parts[0].strip()
            alias = parts[1].strip() if len(parts) > 1 else module.split(".")[-1]
            import_map[alias] = module
        elif line.startswith("from "):
            # from module import name as alias
            m = re.match(r"from\s+([\w\.]+)\s+import\s+([\w\,\s]+)", line)
            if m:
                mod = m.group(1)
                names = m.group(2).split(",")
                for n in names:
                    n = n.strip()
                    if " as " in n:
                        real, alias = n.split(" as ")
                        import_map[alias.strip()] = f"{mod}.{real.strip()}"
                    else:
                        import_map[n] = f"{mod}.{n}"
    return import_map


def qualify_calls_in_line(
    line: str,
    imports_map: Dict[str, str],  # maps fn_name -> module path like backend.services.analytics_processor
    local_funcs: set,             # functions defined in this file
    current_file: str,
    repo_root: str
) -> str:
    """
    Replace function calls in a line with /repo-relative-path::func_name
    using imports or local functions.
    """

    def replacer(match):
        fn = match.group(0).rstrip("(").strip()

        # Local function in this file
        if fn in local_funcs:
            rel_path = "/" + os.path.relpath(current_file, repo_root).replace("\\", "/")
            return f"{rel_path}::{fn}("

        # Imported function
        elif fn in imports_map:
            # Get module string from import
            module_str = imports_map[fn]  # e.g., ".analytics_processor"

            # Resolve relative to current file package
            current_file_pkg = Path(current_file).parent.relative_to(repo_root).as_posix()  # backend/services
            if module_str.startswith("."):
                # handle relative import
                rel_module_path = module_str.lstrip(".")  # remove dots
                parts = rel_module_path.split(".")
                file_name = parts[0]
                func_name = parts[1]
                rel_module_path = file_name+".py::"+func_name
                full_module_path = Path(current_file_pkg) / rel_module_path
            else:
                # absolute import
                full_module_path = Path(module_str.replace(".", "/"))

            # Final repo-relative path
            rel_path = "/" + full_module_path.as_posix()


            return f"{rel_path}::{fn}("

        # Unknown / builtin
        else:
            return fn + "("

    return re.sub(r"\b[A-Za-z_]\w*\s*\(", replacer, line)


def extract_functions_from_file(path: str, function_names: set, repo_root: Optional[str] = None):
    text = Path(path).read_text().splitlines()
    results = {}
    current_name = None
    current_body = []

    # parse imports
    imports_map = parse_imports(path)
    local_funcs = set()

    for line in text:
        m = PY_FUNC_DEF.match(line)
        if m:
            name = m.group(1)
            if current_name and current_body:
                full_body = "\n".join([qualify_calls_in_line(l, imports_map, local_funcs, path, repo_root) for l in current_body])
                key = make_full_id(path, current_name)
                results[key] = full_body
                save_function(path, current_name, full_body, repo_root)
            current_name = name if name in function_names else None
            if current_name:
                local_funcs.add(current_name)
            current_body = [line] if current_name else []
        elif current_name:
            current_body.append(line)

    # save last function
    if current_name and current_body:
        full_body = "\n".join([qualify_calls_in_line(l, imports_map, local_funcs, path, repo_root) for l in current_body])
        key = make_full_id(path, current_name)
        results[key] = full_body
        save_function(path, current_name, full_body, repo_root)

    return results


# ----------------- AST helpers to find calls ----------------- #
def find_calls_ast(body: str) -> List[str]:
    """
    Parse function body using AST and return names of all called functions.
    Returns bare names (e.g., 'process_metric_stats' or attribute name 'process_metric_stats').
    """
    found = set()
    code = body
    try:
        node = ast.parse(code)
    except SyntaxError:
        return list(found)

    for n in ast.walk(node):
        if isinstance(n, ast.Call):
            if isinstance(n.func, ast.Name):
                found.add(n.func.id)
            elif isinstance(n.func, ast.Attribute):
                # attribute calls: foo.bar()
                # we'll treat attribute name (bar) for resolution (imports handled separately)
                found.add(n.func.attr)
    return list(found)


# ----------------- Repo index & import parsing ----------------- #
def build_repo_index(repo_root: str) -> Dict[str, List[str]]:
    """
    Walk the repo and build an index: function_name -> list of repo-relative file paths that define it.
    Only top-level defs considered.
    """
    index: Dict[str, List[str]] = {}
    for root, dirs, files in os.walk(repo_root):
        # skip .git and env dirs quickly
        if ".git" in dirs:
            dirs.remove(".git")
        for fname in files:
            if not fname.endswith(".py"):
                continue
            fpath = os.path.join(root, fname)
            # skip virtualenvs commonly named .venv or venv
            if "/.venv/" in fpath or "/venv/" in fpath or "\\.venv\\" in fpath or "\\venv\\" in fpath:
                continue
            rel = os.path.relpath(fpath, repo_root).replace("\\", "/")
            try:
                src = Path(fpath).read_text()
                tree = ast.parse(src)
            except Exception:
                continue
            for node in tree.body:
                if isinstance(node, ast.FunctionDef):
                    index.setdefault(node.name, []).append(rel)
    return index




# ----------------- Resolution ----------------- #
def resolve_call(
    fn_name: str,
    bindings: Dict[str, str],
    current_file_abs: str,
    repo_root: str,
    repo_index: Dict[str, List[str]],
) -> str:
    """
    Resolve a function call into repo-relative path::fn_name only when the target lives inside repo_root.
    Returns either:
      - "rel/path.py::fn_name" (repo-local)
      - "fn_name" (external or ambiguous)
    """
    # 1) Imported binding (e.g., from utils.parser import parse -> bindings['parse'] == 'utils.parser')
    if fn_name in bindings:
        mod = bindings[fn_name]
        mod_path = mod.replace(".", "/") + ".py"
        abs_mod_path = os.path.join(repo_root, mod_path)
        if os.path.isfile(abs_mod_path):
            rel = os.path.relpath(abs_mod_path, repo_root).replace("\\", "/")
            return f"{rel}::{fn_name}"
        # imported module not in repo -> external library; don't qualify
        return fn_name

    # 2) Is fn defined in current file? check AST quickly
    try:
        src = Path(current_file_abs).read_text()
        tree = ast.parse(src)
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name == fn_name:
                rel = os.path.relpath(current_file_abs, repo_root).replace("\\", "/")
                return f"{rel}::{fn_name}"
    except Exception:
        pass

    # 3) Repo index: unique definition
    candidates = repo_index.get(fn_name, [])
    if len(candidates) == 1:
        return f"{candidates[0]}::{fn_name}"
    # ambiguous or not found -> return plain
    return fn_name


# ----------------- Graph builders ----------------- #
def build_changed_call_graph(
    function_bodies: Dict[str, str],
    file_map: Dict[str, str],
    repo_root: str,
) -> Dict[str, List[str]]:
    """
    Build call graph for changed functions.
    Keys are full ids "/rel/path.py::fn" (repo-root relative from root).
    Values are lists of resolved call targets (either '/rel/path.py::fn' or plain 'fn').
    """
    graph: Dict[str, List[str]] = {}

    for full_id, body in function_bodies.items():
        # full_id is "rel/path.py::fn"
        try:
            rel_file, fn_name = full_id.split("::", 1)
        except ValueError:
            continue

        current_file_abs = os.path.join(repo_root, rel_file)
        calls = find_calls_ast(body)

        # Parse imports to map function -> module
        bindings = parse_imports(current_file_abs) if os.path.isfile(current_file_abs) else {}

        resolved_calls = []
        for c in calls:
            if c in bindings:
                # Resolve import relative to repo root
                module_str = bindings[c]  # e.g., ".analytics_processor" or "backend.services.analytics_processor"
                current_pkg = Path(current_file_abs).parent.relative_to(repo_root).as_posix()
                if module_str.startswith("."):
                    # relative import
                    rel_module_path = module_str.lstrip(".")
                    full_module_path = Path(current_pkg) / rel_module_path
                else:
                    # absolute import
                    full_module_path = Path(module_str.replace(".", "/"))
                call_key = "/" + full_module_path.as_posix() + ".py::" + c
            else:
                call_key = c  # local function or unknown/builtin
            resolved_calls.append(call_key)

        # Use repo-relative path for parent key
        parent_key = "/" + Path(current_file_abs).relative_to(repo_root).as_posix() + f"::{fn_name}"

        graph[parent_key] = resolved_calls

    return graph



def find_parent_functions_changed_only(graph: Dict[str, List[str]]) -> List[str]:
    all_funcs = set(graph.keys())
    called_by_changed = set()
    for fn, calls in graph.items():
        for c in calls:
            # if c is qualified (rel/path::name), use it; otherwise extract tail name and try to find matching full ids
            if "::" in c:
                target_full = c
            else:
                # try to find any changed function with that trailing name
                matches = [f for f in all_funcs if f.endswith("::" + c)]
                target_full = matches[0] if len(matches) == 1 else None
            if target_full and target_full in all_funcs:
                called_by_changed.add(target_full)
    parents = list(all_funcs - called_by_changed)
    return parents


def save_graph(graph: Dict[str, List[str]]):
    file_path = "call_graph.json"
    path = Path(file_path)
    with path.open("w") as f:
        json.dump(graph, f, indent=2)


def save_parent_functions(parents: List[str]):
    file_path = "parent_functions.json"
    path = Path(file_path)
    with path.open("w") as f:
        json.dump(parents, f, indent=2)


# ----------------- main ----------------- #
def main(argv: Optional[List[str]] = None):
    p = argparse.ArgumentParser()
    p.add_argument("--repo", required=False, default="/home/bimal/Documents/ucsd/research/code/trap", help="path to the git repo to analyze")
    args = p.parse_args(argv)

    repo_root = os.path.abspath(args.repo)

    try:
        # 1) get git diff and parse changed files/hunks
        res = run_git_diff(repo_root)
        parsed = parse_diff(res[1])
        changed_funcs = find_changed_functions(parsed)  # map: repo-relative file -> set(fn)
        if not changed_funcs:
            print(json.dumps({"parents": []}, indent=2))
            return

        # 2) Build repo index for resolution

        repo_index = build_repo_index(repo_root)

        # 3) Extract bodies for changed functions and build function_bodies keyed by full_id
        all_func_bodies: Dict[str, str] = {}
        file_map: Dict[str, str] = {}  # full_id -> abs path
        for rel_file, funcs in changed_funcs.items():
            abs_file = os.path.join(repo_root, rel_file)
            extracted = extract_functions_from_file(abs_file, funcs, repo_root=repo_root)
            # extracted: full_id -> body
            for full_id, body in extracted.items():
                all_func_bodies[full_id] = body
                # store absolute path for that full_id's file part
                rel_file_part, fn_name = full_id.split("::", 1)
                file_map[full_id] = os.path.join(repo_root, rel_file_part)


        # 4) Build call graph for changed functions
        call_graph = build_changed_call_graph(all_func_bodies, file_map, repo_root)
        save_graph(call_graph)
        # 5) Save outputs
        parents = find_parent_functions_changed_only(call_graph)
        save_parent_functions(parents)

        # Note: extract_functions_from_file already called save_function which wrote functions.json
        # But ensure we write only changed functions' bodies (functions.json already contains full_id keys)
        # Print parents as main CLI output
        print(json.dumps({"parents": parents}, indent=2), file=sys.stdout)

    except Exception as e:
        raise e
        # print(json.dumps({"error": str(e)}), file=sys.stdout)
        # sys.exit(1)


if __name__ == "__main__":
    main()
