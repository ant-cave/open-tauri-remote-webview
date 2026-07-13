use serde_json::Value;
use std::collections::HashMap;
use std::sync::RwLock;

type CommandFn = Box<dyn Fn(Option<Value>) -> Result<Value, String> + Send + Sync>;

/// A registry of Tauri commands accessible via WebSocket without a WebView.
///
/// Commands registered here can be dispatched directly from the Rust side,
/// bypassing the WebView `window.eval()` path entirely.
pub struct CommandRegistry {
    commands: RwLock<HashMap<String, CommandFn>>,
}

impl CommandRegistry {
    pub fn new() -> Self {
        CommandRegistry {
            commands: RwLock::new(HashMap::new()),
        }
    }

    /// Register a command handler.
    ///
    /// `args` receives the raw JSON arguments from the WS invoke request.
    /// Return `Ok(value)` on success or `Err(msg)` on failure.
    pub fn register<F>(&self, name: &str, f: F)
    where
        F: Fn(Option<Value>) -> Result<Value, String> + Send + Sync + 'static,
    {
        let mut map = self.commands.write().unwrap();
        map.insert(name.to_owned(), Box::new(f));
    }

    /// Dispatch a command by name.
    ///
    /// Returns `None` if the command is not registered (caller should
    /// fall back to the WebView path).
    pub fn dispatch(&self, cmd: &str, args: Option<Value>) -> Option<Result<Value, String>> {
        let map = self.commands.read().unwrap();
        map.get(cmd).map(|f| f(args))
    }
}
