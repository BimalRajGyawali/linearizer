// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::process::Command;
use serde_json::Value;
use std::path::Path;

#[tauri::command]
fn greet(name: &str) -> String {
    println!("[flowlens] greet called with name={}", name);
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_flows() -> Result<Value, String> {
    println!("[flowlens] get_flows: starting");

    // Determine repo path and range defaults
    let repo = "/home/bimal/Documents/ucsd/research/code/tauri/linearization";
    println!("[flowlens] repo path = {}", repo);

    // Build command to run the Python script. Use python3 if available.
    let python = std::env::var("PYTHON_BIN").unwrap_or_else(|_| "python3".to_string());
    let script_path = "../tools/get_changed_functions.py";

    // Resolve script path for logging
    let script_display = Path::new(script_path)
        .canonicalize()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| script_path.to_string());

    println!(
        "[flowlens] will run python binary: '{}' script: '{}'",
        python, script_display
    );

    let args = vec![script_path, "--repo", repo];
    println!("[flowlens] running: {} {:?}", python, args);

    let output = match Command::new(&python).arg(script_path).arg("--repo").arg(&repo).output() {
        Ok(o) => o,
        Err(e) => {
            eprintln!("[flowlens] failed to spawn python script: {}", e);
            return Err(format!("failed to spawn python script: {}", e));
        }
    };

    println!(
        "[flowlens] python exited (success = {})",
        output.status.success()
    );

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    // Always log raw outputs for traceability (may be large)
    println!("[flowlens] python stdout:\n{}", stdout);
    if !stderr.is_empty() {
        eprintln!("[flowlens] python stderr:\n{}", stderr);
    }

    if !output.status.success() {
        return Err(format!("python script failed: {}", stderr));
    }

    // Try to parse JSON and pretty-print for logs on success, or return detailed error
    match serde_json::from_str::<Value>(&stdout) {
        Ok(v) => {
            match serde_json::to_string_pretty(&v) {
                Ok(pretty) => println!("[flowlens] parsed json:\n{}", pretty),
                Err(_) => println!("[flowlens] parsed json (compact): {}", v),
            }
            Ok(v)
        }
        Err(e) => {
            eprintln!(
                "[flowlens] invalid json from python script: {}\nraw stdout:\n{}\nraw stderr:\n{}",
                e, stdout, stderr
            );
            Err(format!(
                "invalid json from python script: {}\noutput:\n{}\nerr:\n{}",
                e, stdout, stderr
            ))
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    println!("[flowlens] run: starting tauri builder");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, get_flows])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
