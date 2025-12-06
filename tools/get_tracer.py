import argparse
import sys
import os
import json
import importlib.util
import types
import traceback
import bdb

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

# --------------------------
# Procedural tracer using bdb
# --------------------------
def run_with_stop_line(fn, args, kwargs, stop_line, filename):
    events = []
    debugger = bdb.Bdb()

    def trace(frame):
        lineno = frame.f_lineno
        fname = os.path.abspath(frame.f_code.co_filename)
        func = frame.f_code.co_name
        locals_snapshot = {k: safe_json(v) for k, v in frame.f_locals.items()}

        events.append({
            "event": "line",
            "filename": fname,
            "function": func,
            "line": lineno,
            "locals": locals_snapshot
        })

        if lineno >= stop_line and fname == filename:
            print(f"Stopping at {lineno} in {filename}")
            debugger.set_quit()  # halts execution

    debugger.user_line = trace
    debugger.runctx(
        "res = fn(*args, **kwargs)",
        globals={"fn": fn, "args": args, "kwargs": kwargs},
        locals={}
    )
    return events

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo_root", required=False, default="/home/bimal/Documents/ucsd/research/code/trap")
    parser.add_argument("--entry_full_id", required=False, default="backend/services/analytics.py::get_metric_period_analytics")
    parser.add_argument("--args_json", required=False, default='{"kwargs": {"metric_name": "test", "period": "last_7_days"}}')
    parser.add_argument("--stop_line", required=False, type=int, default=103)

    args = parser.parse_args()

    repo_root = args.repo_root
    entry_full_id = args.entry_full_id
    args_json = args.args_json
    stop_line = args.stop_line

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

    args_list = []
    kwargs_dict = {}
    if args_json:
        try:
            parsed = json.loads(args_json)
            args_list = parsed.get("args", [])
            kwargs_dict = parsed.get("kwargs", {})
        except Exception:
            pass

    try:
        events = run_with_stop_line(fn, args_list, kwargs_dict, stop_line, abs_path)
        events = events[1:]
        print(json.dumps({"events": events}, indent=2))
    except Exception as e:
        print(json.dumps({"event": "error", "error": str(e), "traceback": traceback.format_exc()}), flush=True)

if __name__ == "__main__":
    main()
