import sys
import time
import types
import importlib.util
import traceback
from typing import Dict, List, Optional, Tuple, Set


def import_module_from_path(repo_root: str, rel_path: str):
    """
    Import a Python file from repo_root/rel_path while supporting relative imports.
    rel_path: like "backend/services/analytics.py"
    """
    import os
    import importlib.util
    import sys

    # Normalize
    rel_path = rel_path.lstrip("/")
    abs_path = os.path.join(repo_root, rel_path)

    # Convert to module name: backend/services/analytics.py → backend.services.analytics
    mod_name = rel_path[:-3].replace("/", ".")

    # Ensure repo root is on sys.path
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

    # Create spec
    spec = importlib.util.spec_from_file_location(mod_name, abs_path)
    module = importlib.util.module_from_spec(spec)

    # Ensure package parent exists so relative imports work
    pkg_name = ".".join(mod_name.split(".")[:-1])
    if pkg_name:
        module.__package__ = pkg_name

    # Execute
    spec.loader.exec_module(module)  # type: ignore

    return module


def safe_json(value):
    """
    Safely convert a value to a JSON-serializable representation.
    Avoids crashing on FrameSummary, modules, functions, etc.
    """
    import types
    try:
        # basic types are safe
        if isinstance(value, (str, int, float, bool, type(None))):
            return value
        # lists/tuples/sets
        if isinstance(value, (list, tuple, set)):
            return [safe_json(v) for v in value]
        # dicts
        if isinstance(value, dict):
            return {str(k): safe_json(v) for k, v in value.items()}
        # functions, modules, classes, frames, traceback, etc
        if isinstance(value, (types.FunctionType, types.ModuleType, type, types.FrameType, types.TracebackType)):
            return f"<{type(value).__name__}>"
        # fallback to string
        return str(value)
    except Exception:
        return f"<unserializable {type(value).__name__}>"


def tracer_factory(events_list: list, repo_root: str):
    repo_root = os.path.abspath(repo_root)  # normalize

    def tracer(frame, event, arg):
        filename = os.path.abspath(frame.f_code.co_filename)

        # Only trace files inside repo_root
        if not filename.startswith(repo_root):
            return None  # don't trace this frame

        func = frame.f_code.co_name
        lineno = frame.f_lineno
        locals_snapshot = {k: safe_json(v) for k, v in frame.f_locals.items()}

        if event == "line":
            events_list.append({
                "event": "line",
                "filename": filename,
                "function": func,
                "line": lineno,
                "locals": locals_snapshot
            })
        elif event == "return":
            events_list.append({
                "event": "return",
                "filename": filename,
                "function": func,
                "value": safe_json(arg)
            })

        return tracer

    return tracer


def run_trace(repo_root: str, entry_full_id: str, args_json: Optional[str]):
    """
    Collect all trace events and return them as a list.
    """
    import os
    import json

    events = []

    # parse path and function
    if "::" not in entry_full_id:
        return {"error": "invalid entry id", "events": events}

    rel_path, fn_name = entry_full_id.split("::", 1)
    rel_path_no = rel_path.lstrip("/")
    abs_path = os.path.join(repo_root, rel_path_no)
    if not os.path.isfile(abs_path):
        return {"error": "file not found", "file": abs_path, "events": events}

    # load module
    try:
        mod = import_module_from_path(repo_root, rel_path_no)
    except Exception as e:
        traceback_str = traceback.format_exc()
        return {"error": "module import failed", "exception": str(e), "traceback": traceback_str, "events": events}

    if not hasattr(mod, fn_name):
        return {"error": "function not found", "function": fn_name, "events": events}

    fn = getattr(mod, fn_name)

    # parse args
    args = []
    kwargs = {}
    if args_json:
        try:
            parsed = json.loads(args_json)
            args = parsed.get("args", [])
            kwargs = parsed.get("kwargs", {})
        except Exception:
            pass

    # tracer will append events to events list
    tracer = tracer_factory(events, repo_root)
    sys.settrace(tracer)
    try:
        res = fn(*args, **kwargs)
        events.append({"event": "done", "result": safe_json(res)})
    except Exception as e:
        traceback_str = traceback.format_exc()
        events.append({"event": "error", "error": str(e), "traceback": traceback_str})
    finally:
        sys.settrace(None)

    return {"events": events}



if __name__ == "__main__":
    import os
    import json
    import argparse
    parser = argparse.ArgumentParser(description="Get tracer for user code execution")
    parser.add_argument("--repo-root", type=str, required=False,
                        default="/home/bimal/Documents/ucsd/research/code/trap",
                        help="Path to the repository root")

    parser.add_argument("--entry-full-id", type=str, required=False,
                        default="/backend/services/analytics.py::get_metric_time_based_stats",
                        help="Entry full id in format /rel/path.py::func")

    parser.add_argument(
        "--args-json",
        type=str,
        required=False,
        default='{"args": [], "kwargs": {"metric_name": "test", "window_size": "daily"}}',
        help="JSON string for function arguments"
    )

    args = parser.parse_args()

    # Run trace and collect all events
    result = run_trace(args.repo_root, args.entry_full_id, args.args_json)

    # Print a single JSON object containing all events
    print(json.dumps(result, indent=2))
    sys.exit(0)
