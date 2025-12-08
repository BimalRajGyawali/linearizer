// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde_json::{json, Value};
use serde::Deserialize;
use std::io::{BufRead, BufReader, Write};
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

    let tracer = tracer_guard.as_mut().unwrap();
    println!("[Rust] Current flow = {:?}", tracer.current_flow);


    // If new flow, tell Python to reset and start new flow
    if tracer.current_flow.as_deref() != Some(&req.entry_full_id) {
        println!("[Rust] New flow detected, sending start_flow");
    }

    // Send continue command
    if !first_time {
        println!("[Rust] Sending continue_to {}", req.stop_line);

        writeln!(tracer.stdin, "{}", req.stop_line)
        .map_err(|e| format!("Failed to write continue_to to Python stdin: {}", e))?;

        tracer.stdin.flush().map_err(|e| format!("Failed to flush stdin: {}", e))?;

      } else {
        println!("[Rust] First time — not sending continue_to");
    }


    // Read Python stdout for the JSON event
    let mut line = String::new();
    tracer.stderr.read_line(&mut line)
        .map_err(|e| format!("Failed to read Python stdout: {}", e))?;

//     let json_str = &line["TRACER:".len()..];

    let event_json: Value = serde_json::from_str(&line)
        .map_err(|e| format!("Failed to parse JSON from Python: {} -- line: {}", e, line))?;

    println!("[Rust] Parsed event JSON = {}", event_json);
    Ok(event_json)
}




#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    println!("[flowlens] run: starting tauri builder");
    tauri::Builder::default()
        .manage(Mutex::new(None::<Tracer>))  // register the shared tracer state
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, get_flows, get_file_tree, get_tracer_data])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
