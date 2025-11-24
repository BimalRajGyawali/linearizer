import json
from pathlib import Path

def build_tree(path: Path):
    """Return a VSCode-like folder/file tree."""
    node = {
        "name": path.name,
        "path": str(path),
        "type": "folder" if path.is_dir() else "file",
    }

    if path.is_dir():
        children = []
        for p in sorted(path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            # Ignore hidden/venv/build/junk
            if p.name.startswith("."):
                continue
            children.append(build_tree(p))
        node["children"] = children

    return node


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=False, default=".")
    args = parser.parse_args()

    root_path = Path(args.root).resolve()
    tree = build_tree(root_path)

    print(json.dumps(tree, indent=2))
