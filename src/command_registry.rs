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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_registry_is_empty() {
        let registry = CommandRegistry::new();
        let result = registry.dispatch("anything", None);
        assert!(result.is_none());
    }

    #[test]
    fn register_and_dispatch_no_args() {
        let registry = CommandRegistry::new();
        registry.register("ping", |_args| Ok(Value::String("pong".into())));
        let result = registry.dispatch("ping", None);
        assert_eq!(result.unwrap().unwrap(), "pong");
    }

    #[test]
    fn register_and_dispatch_with_args() {
        let registry = CommandRegistry::new();
        registry.register("echo", |args| Ok(args.unwrap_or(Value::Null)));
        let args = Some(serde_json::json!({"msg": "hello"}));
        let result = registry.dispatch("echo", args);
        assert_eq!(
            result.unwrap().unwrap(),
            serde_json::json!({"msg": "hello"})
        );
    }

    #[test]
    fn dispatch_unknown_command_returns_none() {
        let registry = CommandRegistry::new();
        registry.register("known", |_| Ok(Value::Null));
        let result = registry.dispatch("unknown", None);
        assert!(result.is_none());
    }

    #[test]
    fn command_returns_error() {
        let registry = CommandRegistry::new();
        registry.register("fail", |_| Err("something went wrong".into()));
        let result = registry.dispatch("fail", None);
        assert_eq!(result.unwrap().unwrap_err(), "something went wrong");
    }

    #[test]
    fn command_receives_null_args_when_none() {
        let registry = CommandRegistry::new();
        registry.register("check", |args| {
            assert!(args.is_none());
            Ok(Value::Bool(true))
        });
        let result = registry.dispatch("check", None);
        assert!(result.unwrap().unwrap().as_bool().unwrap());
    }

    #[test]
    fn multiple_commands_independent() {
        let registry = CommandRegistry::new();
        registry.register("add", |args| {
            let arr = args.unwrap().as_array().unwrap().clone();
            let sum: i64 = arr.iter().filter_map(|v| v.as_i64()).sum();
            Ok(serde_json::json!(sum))
        });
        registry.register("mul", |args| {
            let arr = args.unwrap().as_array().unwrap().clone();
            let prod: i64 = arr.iter().filter_map(|v| v.as_i64()).product();
            Ok(serde_json::json!(prod))
        });

        let add_result = registry.dispatch("add", Some(serde_json::json!([3, 4])));
        assert_eq!(add_result.unwrap().unwrap(), 7);

        let mul_result = registry.dispatch("mul", Some(serde_json::json!([3, 4])));
        assert_eq!(mul_result.unwrap().unwrap(), 12);
    }

    #[test]
    fn registry_is_send_sync() {
        fn assert_send<T: Send>() {}
        fn assert_sync<T: Sync>() {}
        assert_send::<CommandRegistry>();
        assert_sync::<CommandRegistry>();
    }

    #[test]
    fn concurrent_access() {
        let registry = std::sync::Arc::new(CommandRegistry::new());
        let mut handles = Vec::new();

        for i in 0..10 {
            let reg = registry.clone();
            handles.push(std::thread::spawn(move || {
                reg.register(&format!("cmd_{i}"), move |_| Ok(serde_json::json!(i)));
            }));
        }
        for h in handles {
            h.join().unwrap();
        }

        for i in 0..10 {
            let result = registry.dispatch(&format!("cmd_{i}"), None);
            assert_eq!(result.unwrap().unwrap(), i);
        }
    }
}
