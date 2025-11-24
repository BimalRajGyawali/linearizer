// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::process::Command;
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


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    println!("[flowlens] run: starting tauri builder");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, get_flows, get_file_tree])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
