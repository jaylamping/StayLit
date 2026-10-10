use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Emitter};

struct Shared {
    pending: Mutex<HashMap<String, mpsc::Sender<Value>>>,
    app: Mutex<Option<AppHandle>>,
}

pub struct Sidecar {
    child: Mutex<Child>,
    stdin: Mutex<std::process::ChildStdin>,
    shared: Arc<Shared>,
    next_id: AtomicU64,
}

impl Sidecar {
    pub fn spawn(data_dir: &Path) -> Result<Self, String> {
        let script = sidecar_script();
        if !script.is_file() {
            return Err(format!("Node sidecar not found at {}", script.display()));
        }
        let node = std::env::var("STAYLIT_NODE").unwrap_or_else(|_| "node".to_string());
        let mut command = Command::new(&node);
        command
            .arg(&script)
            .env("STAYLIT_DATA_DIR", data_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command.spawn().map_err(|err| format!("failed to start {node}: {err}"))?;
        let stdin = child.stdin.take().ok_or("sidecar stdin missing")?;
        let stdout = child.stdout.take().ok_or("sidecar stdout missing")?;
        let stderr = child.stderr.take().ok_or("sidecar stderr missing")?;
        let shared = Arc::new(Shared {
            pending: Mutex::new(HashMap::new()),
            app: Mutex::new(None),
        });
        let reader_state = Arc::clone(&shared);
        std::thread::spawn(move || read_stdout(stdout, reader_state));
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(text) => eprintln!("staylit-sidecar: {text}"),
                    Err(_) => break,
                }
            }
        });
        Ok(Sidecar {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            shared,
            next_id: AtomicU64::new(1),
        })
    }

    pub fn set_app(&self, app: AppHandle) {
        *self.shared.app.lock().expect("sidecar app lock") = Some(app);
    }

    pub fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        let (tx, rx) = mpsc::channel();
        self.shared
            .pending
            .lock()
            .expect("sidecar pending lock")
            .insert(id.clone(), tx);
        let line = serde_json::json!({
            "id": id,
            "method": method,
            "params": params
        });
        {
            let mut stdin = self.stdin.lock().expect("sidecar stdin lock");
            writeln!(stdin, "{line}").map_err(|err| format!("sidecar write failed: {err}"))?;
            stdin.flush().map_err(|err| format!("sidecar flush failed: {err}"))?;
        }
        let wait = rx.recv_timeout(Duration::from_secs(10));
        self.shared.pending.lock().expect("sidecar pending lock").remove(&id);
        let value = match wait {
            Ok(value) => value,
            Err(mpsc::RecvTimeoutError::Timeout) => return Err("sidecar timed out".to_string()),
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err("sidecar stopped".to_string()),
        };
        if value.get("ok").and_then(Value::as_bool) == Some(true) {
            Ok(value.get("result").cloned().unwrap_or(Value::Null))
        } else {
            let message = value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .unwrap_or("sidecar error");
            Err(message.to_string())
        }
    }

    pub fn stop(&self) {
        let mut child = self.child.lock().expect("sidecar child lock");
        let _ = child.kill();
        let _ = child.wait();
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        self.stop();
    }
}

fn read_stdout(stdout: std::process::ChildStdout, shared: Arc<Shared>) {
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
        let Ok(line) = line else {
            break;
        };
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(id) = value.get("id").and_then(Value::as_str) {
            let sender = shared.pending.lock().expect("sidecar pending lock").remove(id);
            if let Some(sender) = sender {
                let _ = sender.send(value);
            }
            continue;
        }
        if value.get("event").is_some() {
            if let Some(app) = shared.app.lock().expect("sidecar app lock").clone() {
                let _ = app.emit("staylit", value);
            }
        }
    }
}

fn sidecar_script() -> PathBuf {
    if let Ok(path) = std::env::var("STAYLIT_SIDECAR") {
        return PathBuf::from(path);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../sidecar/src/index.js")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sidecar_answers_ping_over_stdio() {
        let dir = std::env::temp_dir().join(format!("staylit-ping-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let sidecar = Sidecar::spawn(&dir).expect("spawn sidecar");
        let result = sidecar.request("ping", json!({})).expect("ping");
        assert_eq!(result.get("pong").and_then(Value::as_bool), Some(true));
        let _ = sidecar.request("shutdown", json!({}));
        sidecar.stop();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
