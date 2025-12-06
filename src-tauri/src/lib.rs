// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader, Write};
use serde_json::{json, Value};


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




/// Execute Python script for one line and return a single JSON event.
/// `repo` - repo root
/// `entry_full_id` - like "/backend/services/analytics.py::get_metric_time_based_stats"
/// `args_json` - JSON string with args and kwargs
#[tauri::command]
fn get_next_tracer_event(
    entry_full_id: &str,
    line_number: i32,
    args_json: &str
) -> Result<Value, String> {

    println!("Requested next trace event for line: {}", line_number);

    let repo = "/home/bimal/Documents/ucsd/research/code/trap";
    let python = std::env::var("PYTHON_BIN").unwrap_or_else(|_| "python3".to_string());
    let script_path = "../tools/get_tracer.py";

    println!("{}", entry_full_id);

    // ----------------------------------------
    // Start Python step-tracer
    // ----------------------------------------
    let mut child = Command::new(&python)
    .arg(script_path)
    .arg("--repo_root")
    .arg(&repo)
    .arg("--entry_full_id")
    .arg(entry_full_id)
    .arg("--args_json")
    .arg(args_json)
    .arg("--stop_line")
    .arg(line_number.to_string()) // <-- pass the clicked line
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .spawn()
    .map_err(|e| format!("Failed to spawn Python: {}", e))?;

    let mut stdin = child.stdin.take().ok_or("Failed to open stdin for Python")?;
    let stdout = child.stdout.take().ok_or("Failed to capture Python stdout")?;
    let mut reader = BufReader::new(stdout);

    // ----------------------------------------
    // Read the FIRST trace event (one line)
    // ----------------------------------------
    let mut event_line = String::new();

    let bytes_read = reader
        .read_line(&mut event_line)
        .map_err(|e| format!("Error reading Python stdout: {}", e))?;

    if bytes_read == 0 {
        return Err("Python process ended unexpectedly".to_string());
    }

    if event_line.trim().is_empty() {
        return Err("Received empty tracer event".to_string());
    }

    // Parse JSON from Python tracer
    let event: Value = serde_json::from_str(event_line.trim())
        .map_err(|e| format!("JSON parse error: {} -- line: {}", e, event_line))?;

    // ----------------------------------------
    // Tell Python to advance one step
    // ----------------------------------------
    stdin
        .write_all(b"\n")
        .map_err(|e| format!("Failed to write to Python stdin: {}", e))?;
    stdin
        .flush()
        .map_err(|e| format!("Failed to flush Python stdin: {}", e))?;

    Ok(event)
}




#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    println!("[flowlens] run: starting tauri builder");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, get_flows, get_file_tree, get_next_tracer_event])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
