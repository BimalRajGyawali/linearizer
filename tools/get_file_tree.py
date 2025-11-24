import os
import json
import subprocess
from pathlib import Path

GIT_STATUS_CODES = {
    "A": "added",
    "M": "modified",
    "D": "deleted",
    "?": "untracked"
}

def git_status(path: Path):
    """Return a dict of file_path -> git status code (A/M/D/?)"""
    try:
        cmd = ["git", "-C", str(path), "status", "--porcelain"]
        out = subprocess.check_output(cmd, text=True)
        status = {}
        for line in out.splitlines():
            code = line[:2].strip()
            file_path = line[3:]
            if code:
                status[file_path] = GIT_STATUS_CODES.get(code[0], "modified")
        return status
    except Exception:
        return {}

def build_tree(path: Path, git_status_dict):
    node = {
        "name": path.name,
        "path": str(path),
        "type": "folder" if path.is_dir() else "file",
        "git": None
    }

    if path.is_file():
        rel_path = os.path.relpath(path, start=repo_root)
        node["git"] = git_status_dict.get(rel_path)

    if path.is_dir():
        children = []
        for p in sorted(path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            if p.name.startswith(".") or p.name.startswith("__pycache__"):
                continue
            children.append(build_tree(p, git_status_dict))
        node["children"] = children

    return node

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=False, default=".")
    args = parser.parse_args()
    repo_root = Path(args.root).resolve()
    git_changes = git_status(repo_root)
    tree = build_tree(repo_root, git_changes)
    print(json.dumps(tree, indent=2))
