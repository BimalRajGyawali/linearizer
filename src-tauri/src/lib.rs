// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde_json::{json, Value};
use serde::Deserialize;
use std::io::{BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, ChildStderr, Command, Stdio};
use tauri::State;
use std::sync::Mutex;


#[tauri::command]
fn greet(name: &str) -> String {
    println!("[flowlens] greet called with name={}", name);
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_flows() -> Result<Value, String> {
    println!("[flowlens] get_flows: starting");

    let repo = "/home/bimal/Documents/ucsd/research/code/trap";
    let python = std::env::var("PYTHON_BIN").unwrap_or_else(|_| "python3".to_string());
    let script_path = "../tools/get_changed_functions.py";

    let output = Command::new(&python)
        .arg(script_path)
        .arg("--repo")
        .arg(&repo)
        .output()
        .map_err(|e| format!("failed to run python: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    if !output.status.success() {
        return Err(format!("python script error: {}", stdout));
    }

    // Load script output (parents)
    let parents_json: Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("invalid json: {}", e))?;

    // Load functions.json saved by Python script
    let functions_json = std::fs::read_to_string("functions.json")
        .unwrap_or_else(|_| "{}".to_string());
    let functions: Value = serde_json::from_str(&functions_json)
        .unwrap_or(Value::Null);

    // Combine result
    let combined = json!({
        "parents": parents_json["parents"],
        "functions": functions
    });

    Ok(combined)
}

#[tauri::command]
fn get_file_tree() -> Result<Value, String> {
    println!("[flowlens] get_file_tree");

    let repo = "/home/bimal/Documents/ucsd/research/code/trap";
    let python = std::env::var("PYTHON_BIN").unwrap_or("python3".to_string());
    let script_path = "../tools/get_file_tree.py";

    let output = Command::new(&python)
        .arg(script_path)
        .arg("--root")
        .arg(repo)
        .output()
        .map_err(|e| format!("failed to run python: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.status.success() {
        return Err(format!("python error: {}", stdout));
    }

    let tree: Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("invalid json: {}", e))?;
    Ok(tree)
}




// ------------------------
// Shared Tracer State
// ------------------------
struct Tracer {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    stderr: BufReader<std::process::ChildStderr>,
    current_flow: Option<String>,
}

impl Tracer {
    fn spawn(req: &TraceRequest) -> Result<Self, String> {
        let python = std::env::var("PYTHON_BIN").unwrap_or("python3".to_string());
        let script_path = "../tools/get_tracer.py";

        let mut child = Command::new(&python)
            .arg("-u")  // Unbuffered mode - critical for subprocess communication
            .arg(script_path)
            .arg("--entry_full_id")
            .arg(&req.entry_full_id)
            .arg("--args_json")
            .arg(&req.args_json)
            .arg("--stop_line")
            .arg(req.stop_line.to_string())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("PYTHONUNBUFFERED", "1")  // Also set env var for extra safety
            .spawn()
            .map_err(|e| format!("Failed to spawn Python process: {}", e))?;

        let stdin = child.stdin.take().ok_or("Failed to open Python stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to capture Python stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to capture Python stderr")?;

        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            stderr: BufReader::new(stderr),
            // set current_flow to entry_full_id
            current_flow: Some(req.entry_full_id.clone()),
        })
    }
}

// ------------------------
// Tauri State Wrapper
// ------------------------
type SharedTracer = Mutex<Option<Tracer>>;

// ------------------------
// Trace Request Struct
// ------------------------
#[derive(Deserialize)]
struct TraceRequest {
    entry_full_id: String,
    args_json: String,
    stop_line: i32,
}


// ------------------------
// Main Tauri Command
// ------------------------
#[tauri::command]
fn get_tracer_data(
    req: TraceRequest,
    tracer_state: State<SharedTracer>
) -> Result<Value, String> {
    use std::io::BufRead;

    println!("[Rust] get_tracer_data called");
    println!("[Rust] req.entry_full_id = {}", req.entry_full_id);
    println!("[Rust] req.args_json = {}", req.args_json);
    println!("[Rust] req.stop_line = {}", req.stop_line);

    // Acquire lock
    let mut tracer_guard = tracer_state.lock().unwrap();
    println!("[Rust] tracer alive = {}", tracer_guard.is_some());

    let first_time = tracer_guard.is_none();

    // Spawn tracer if not alive
    if first_time {
        println!("[Rust] Spawning tracer…");
        *tracer_guard = Some(Tracer::spawn(&req)?);
    }

    // Check if we need to spawn a new tracer for a different function
    let needs_new_tracer = if let Some(ref tracer) = *tracer_guard {
        tracer.current_flow.as_deref() != Some(&req.entry_full_id)
    } else {
        false
    };

    // If new flow detected, kill old tracer and spawn new one
    if needs_new_tracer {
        println!("[Rust] New flow detected (old: {:?}, new: {}), spawning new tracer", 
                 tracer_guard.as_ref().unwrap().current_flow, req.entry_full_id);
        
        // Kill the old tracer process
        if let Some(ref mut old_tracer) = *tracer_guard {
            let _ = old_tracer.child.kill(); // Ignore errors if already dead
            let _ = old_tracer.child.wait(); // Wait for it to finish
        }
        
        // Spawn new tracer for the new function
        *tracer_guard = Some(Tracer::spawn(&req)?);
    }

    let tracer = tracer_guard.as_mut().unwrap();
    println!("[Rust] Current flow = {:?}", tracer.current_flow);

    // Determine if this is the first call for this tracer
    // It's the first call if: this is the first time overall, OR we just spawned a new tracer
    let is_first_call = first_time || needs_new_tracer;

    // Send continue command
    if !is_first_call {
        println!("[Rust] Sending continue_to {}", req.stop_line);

        writeln!(tracer.stdin, "{}", req.stop_line)
        .map_err(|e| format!("Failed to write continue_to to Python stdin: {}", e))?;

        tracer.stdin.flush().map_err(|e| format!("Failed to flush stdin: {}", e))?;
    } else {
        println!("[Rust] First call for this function — Python will send initial event");
    }

    // Read from stderr (Python writes events to stderr)
    // Use a timeout to prevent indefinite blocking
    let mut line = String::new();
    println!("[Rust] Reading event from Python stderr (stop_line={})...", req.stop_line);
    
    // Check if process is still alive before reading
    if let Ok(Some(status)) = tracer.child.try_wait() {
        return Err(format!("Python process exited with status: {:?} before reading event", status));
    }
    
    // Try to read with a timeout by checking process status periodically
    // Since read_line is blocking, we'll use a simple approach: check process status first
    // and rely on Python's timeout (30s) to send an error event if it hangs
    let read_result = tracer.stderr.read_line(&mut line);
    
    // After attempting to read, check if process died
    if let Ok(Some(status)) = tracer.child.try_wait() {
        // Process died - check if we got any data
        if line.trim().is_empty() {
            return Err(format!("Python process exited with status: {:?} before sending event", status));
        }
        // If we got some data, continue processing it
    }
    
    // Read one line - Python should send JSON on a single line
    match read_result {
        Ok(0) => {
            // EOF - process might have closed stderr
            if let Ok(Some(status)) = tracer.child.try_wait() {
                return Err(format!("Python process exited with status: {:?} before sending event", status));
            }
            return Err("Python stderr closed unexpectedly (EOF)".to_string());
        }
        Ok(_) => {
            // Successfully read a line
        }
        Err(e) => {
            // Check if process died
            if let Ok(Some(status)) = tracer.child.try_wait() {
                return Err(format!("Python process exited with status: {:?} while reading stderr. Error: {}", status, e));
            }
            return Err(format!("Failed to read Python stderr: {}", e));
        }
    }

let line = line.trim();
println!(
    "[Rust] Received from Python (len={}): {}",
    line.len(),
    if line.len() > 200 {
        format!("{}...", &line[..200])
    } else {
        line.to_string()
    }
);

    if line.is_empty() {
        return Err("Empty response from Python".to_string());
    }

    // Try to parse as JSON
    let event_json: Value = serde_json::from_str(&line)
        .map_err(|e| {
            // If parsing fails, check if it's an error message
            if line.starts_with("Exception") || line.starts_with("Traceback") || line.starts_with("Error:") {
                format!("Python sent error output instead of JSON:\n{}", line)
            } else {
                format!(
                    "Failed to parse JSON from Python: {} -- received: {}",
                    e,
                    if line.len() > 500 {
                        format!("{}...", &line[..500])
                    } else {
                        line.to_string()
                    }
                )
            }
        })?;

    println!("[Rust] Parsed event JSON = {}", event_json);
    Ok(event_json)    
}




#[tauri::command]
fn get_function_signature(entry_full_id: String) -> Result<Value, String> {
    println!("[Rust] get_function_signature called with entry_full_id = {}", entry_full_id);
    
    let repo = "/home/bimal/Documents/ucsd/research/code/trap";
    let python = std::env::var("PYTHON_BIN").unwrap_or("python3".to_string());
    let script_path = "../tools/get_tracer.py";
    
    let output = Command::new(&python)
        .arg("-u")
        .arg(script_path)
        .arg("--repo_root")
        .arg(&repo)
        .arg("--entry_full_id")
        .arg(&entry_full_id)
        .arg("--get_signature")
        .output()
        .map_err(|e| format!("Failed to run Python script: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    
    if !output.status.success() {
        return Err(format!("Python script error: {}", stdout));
    }
    
    let signature: Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse signature JSON: {} -- received: {}", e, stdout))?;
    
    Ok(signature)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    println!("[flowlens] run: starting tauri builder");
    tauri::Builder::default()
        .manage(Mutex::new(None::<Tracer>))  // register the shared tracer state
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, get_flows, get_file_tree, get_tracer_data, get_function_signature])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
