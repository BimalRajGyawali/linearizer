import sys
import os
import json
import importlib.util
import types
import traceback

def import_module_from_path(repo_root: str, rel_path: str):
    rel_path = rel_path.lstrip("/")
    abs_path = os.path.join(repo_root, rel_path)
    mod_name = rel_path[:-3].replace("/", ".")
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)
    spec = importlib.util.spec_from_file_location(mod_name, abs_path)
    module = importlib.util.module_from_spec(spec)
    pkg_name = ".".join(mod_name.split(".")[:-1])
    if pkg_name:
        module.__package__ = pkg_name
    spec.loader.exec_module(module)  # type: ignore
    return module

def safe_json(value):
    try:
        if isinstance(value, (str, int, float, bool, type(None))):
            return value
        if isinstance(value, (list, tuple, set)):
            return [safe_json(v) for v in value]
        if isinstance(value, dict):
            return {str(k): safe_json(v) for k, v in value.items()}
        if isinstance(value, (types.FunctionType, types.ModuleType, type, types.FrameType, types.TracebackType)):
            return f"<{type(value).__name__}>"
        return str(value)
    except Exception:
        return f"<unserializable {type(value).__name__}>"

def tracer_factory(repo_root: str):
    repo_root = os.path.abspath(repo_root)

    def tracer(frame, event, arg):
        filename = os.path.abspath(frame.f_code.co_filename)
        if not filename.startswith(repo_root):
            return None

        func = frame.f_code.co_name
        lineno = frame.f_lineno
        locals_snapshot = {k: safe_json(v) for k, v in frame.f_locals.items()}

        if event == "line":
            event_obj = {
                "event": "line",
                "filename": filename,
                "function": func,
                "line": lineno,
                "locals": locals_snapshot
            }
        elif event == "return":
            event_obj = {
                "event": "return",
                "filename": filename,
                "function": func,
                "value": safe_json(arg)
            }
        elif event == "exception":
            event_obj = {
                "event": "exception",
                "filename": filename,
                "function": func,
                "exception": str(arg)
            }
        else:
            return tracer

        # Print **one event per step**
        print(json.dumps(event_obj), flush=True)

        # Wait for next signal from Rust/frontend
        input()
        return tracer

    return tracer

def main():
    if len(sys.argv) < 4:
        print(json.dumps({"error": "Usage: get_tracer_step.py <repo_root> <entry_full_id> <args_json>"}))
        sys.exit(1)

    repo_root = sys.argv[1]
    entry_full_id = sys.argv[2]
    args_json = sys.argv[3]

    events = []

    if "::" not in entry_full_id:
        print(json.dumps({"error": "invalid entry id"}))
        sys.exit(1)

    rel_path, fn_name = entry_full_id.split("::", 1)
    abs_path = os.path.join(repo_root, rel_path.lstrip("/"))
    if not os.path.isfile(abs_path):
        print(json.dumps({"error": "file not found", "file": abs_path}))
        sys.exit(1)

    try:
        mod = import_module_from_path(repo_root, rel_path.lstrip("/"))
    except Exception as e:
        print(json.dumps({"error": "module import failed", "exception": str(e), "traceback": traceback.format_exc()}))
        sys.exit(1)

    if not hasattr(mod, fn_name):
        print(json.dumps({"error": "function not found", "function": fn_name}))
        sys.exit(1)

    fn = getattr(mod, fn_name)

    args = []
    kwargs = {}
    if args_json:
        try:
            parsed = json.loads(args_json)
            args = parsed.get("args", [])
            kwargs = parsed.get("kwargs", {})
        except Exception:
            pass

    sys.settrace(tracer_factory(repo_root))
    try:
        res = fn(*args, **kwargs)
        print(json.dumps({"event": "done", "result": safe_json(res)}), flush=True)
    except Exception as e:
        print(json.dumps({"event": "error", "error": str(e), "traceback": traceback.format_exc()}), flush=True)
    finally:
        sys.settrace(None)

if __name__ == "__main__":
    main()
