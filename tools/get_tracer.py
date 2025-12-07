import argparse
import sys
import os
import json
import importlib.util
import types
import traceback
import threading
import bdb

# --------------------------
# Helpers
# --------------------------
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
# Persistent Debugger
# --------------------------
class PersistentDebugger(bdb.Bdb):
    def __init__(self):
        super().__init__()
        self.wait_event = threading.Event()
        self.target_line = None
        self.last_event = None
        self.running_thread = None

    def user_line(self, frame):
        lineno = frame.f_lineno
        fname = os.path.abspath(frame.f_code.co_filename)
        # print(f"User line {lineno}: {fname}")
        # Only stop for the main target file
        if fname != self.target_file:
            return

        funcname = frame.f_code.co_name
        locals_snapshot = {k: safe_json(v) for k, v in frame.f_locals.items()}

        self.last_event = {
            "event": "line",
            "filename": fname,
            "function": funcname,
            "line": lineno - 1,
            "locals": locals_snapshot
        }

        # Stop if we've reached the target line
        if self.target_line is not None and lineno >= self.target_line:
            self.set_step()
            self.wait_event.clear()
            self.wait_event.wait()

    def continue_until(self, line):
        self.target_line = line
        self.wait_event.set()

    def run_function_once(self, fn, args=None, kwargs=None):
        args = args or []
        kwargs = kwargs or {}
        self.running_thread = threading.Thread(
            target=lambda: self.runctx(
                "fn(*args, **kwargs)",
                globals={"fn": fn, "args": args, "kwargs": kwargs},
                locals={}
            )
        )
        self.running_thread.start()

# --------------------------
# Main CLI
# --------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo_root",
        required=False,
        default="/home/bimal/Documents/ucsd/research/code/trap"
    )
    parser.add_argument(
        "--entry_full_id",
        required=False,
        default="backend/services/analytics.py::get_metric_period_analytics"
    )
    parser.add_argument(
        "--args_json",
        required=False,
        default='{"kwargs": {"metric_name": "test", "period": "last_7_days"}}'
    )
    parser.add_argument(
        "--stop_line",
        required=False,
        type=int,
        default=100
    )
    args = parser.parse_args()

    repo_root = args.repo_root
    entry_full_id = args.entry_full_id
    args_json = args.args_json
    stop_line = args.stop_line

    args_list = []
    kwargs_dict = {}
    if args_json:
        try:
            parsed = json.loads(args_json)
            args_list = parsed.get("args", [])
            kwargs_dict = parsed.get("kwargs", {})
        except Exception:
            pass

    if "::" not in entry_full_id:
        # print(json.dumps({"error": "invalid entry id"}))
        sys.exit(1)

    rel_path, fn_name = entry_full_id.split("::", 1)
    abs_path = os.path.join(repo_root, rel_path.lstrip("/"))

    if not os.path.isfile(abs_path):
        print(json.dumps({"error": "file not found", "file": abs_path}))
        sys.exit(1)

    try:
        mod = import_module_from_path(repo_root, rel_path)
    except Exception as e:
        print(json.dumps({
            "error": "module import failed",
            "exception": str(e),
            "traceback": traceback.format_exc()
        }))
        sys.exit(1)

    if not hasattr(mod, fn_name):
        print(json.dumps({"error": "function not found", "function": fn_name}))
        sys.exit(1)

    fn = getattr(mod, fn_name)

    dbg = PersistentDebugger()
    dbg.target_file = abs_path  # Only this file counts for stop_line
    dbg.repo_root = repo_root

    dbg.run_function_once(fn, args_list, kwargs_dict)

    # Run until initial stop_line
    dbg.continue_until(stop_line + 1)
    dbg.wait_event.wait()
    # print(json.dumps(dbg.last_event, indent=2), flush=True)

    # Interactive stepping
    while True:
        try:
            user_input = input().strip()
            if not user_input or user_input == "0":
                break
            line = int(user_input)
            dbg.continue_until(line + 1)
            dbg.wait_event.wait()
            # print(json.dumps(dbg.last_event, indent=2))
            print(json.dumps(dbg.last_event, separators=(",", ":")), flush=True)

        except Exception as e:
            print("Error:", e)

if __name__ == "__main__":
    main()
