// MIT License
// Copyright (c) 2025 DraviaVemal
// See LICENSE file in the root directory.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OriginType {
    Localhost,
    Direct,
    Any,
}

impl From<OriginType> for &str {
    fn from(value: OriginType) -> Self {
        match value {
            OriginType::Localhost => "127.0.0.1",
            OriginType::Direct => "::",
            _ => "0.0.0.0",
        }
    }
}

#[derive(Serialize)]
pub struct RemoteUiEvent<P> {
    pub event_name: String,
    pub window_label: Option<String>,
    pub payload: P,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmitRequest {
    pub value: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmitResponse {
    pub value: Option<String>,
}

/// Configuration for the remote UI WebSocket server.
///
/// # Fields
/// - `allowed_origin` — controls which network interface the server binds to
/// - `port` — `None` for a random port, `Some(p)` for a specific port
/// - `enable_log` — toggle server-side log output
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteUiConfig {
    pub(crate) allowed_origin: OriginType,
    pub(crate) port: Option<u16>,
    pub(crate) enable_log: bool,
}

impl Default for RemoteUiConfig {
    fn default() -> Self {
        RemoteUiConfig {
            allowed_origin: OriginType::Localhost,
            port: None,
            enable_log: true,
        }
    }
}

impl RemoteUiConfig {
    /// Enable log output (default: true)
    pub fn enable_log(mut self) -> RemoteUiConfig {
        self.enable_log = true;
        self
    }

    /// Disable log output
    pub fn disable_log(mut self) -> RemoteUiConfig {
        self.enable_log = false;
        self
    }

    /// Set the allowed origin for the WebSocket server.
    /// Controls which network interface the server binds to.
    pub fn set_allowed_origin(mut self, allowed_origin: OriginType) -> RemoteUiConfig {
        self.allowed_origin = allowed_origin;
        self
    }

    /// Set the target port. `None` assigns a random port.
    pub fn set_port(mut self, port: Option<u16>) -> RemoteUiConfig {
        self.port = port;
        self
    }

    pub fn get_allowed_origin(&self) -> OriginType {
        self.allowed_origin
    }

    pub fn get_port(&self) -> Option<u16> {
        self.port
    }
}

// Structure representing the payload of an RPC invoke request
#[derive(Debug, Deserialize)]
pub struct WsPayload {
    pub id: usize,
    pub cmd: String,
    pub args: Option<Value>,
    pub option: Option<Value>,
}

#[derive(Serialize, Deserialize)]
pub(crate) enum RpcResponseStatus {
    Success,
    Error,
    Invalid,
}

impl From<RpcResponseStatus> for &str {
    fn from(value: RpcResponseStatus) -> Self {
        match value {
            RpcResponseStatus::Success => "success",
            RpcResponseStatus::Error => "error",
            _ => "invalid",
        }
    }
}

impl From<&str> for RpcResponseStatus {
    fn from(value: &str) -> Self {
        match value {
            "success" => RpcResponseStatus::Success,
            "error" => RpcResponseStatus::Error,
            _ => RpcResponseStatus::Invalid,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── OriginType ─────────────────────────────────────────────────────────

    #[test]
    fn origin_type_localhost_to_str() {
        let s: &str = OriginType::Localhost.into();
        assert_eq!(s, "127.0.0.1");
    }

    #[test]
    fn origin_type_direct_to_str() {
        let s: &str = OriginType::Direct.into();
        assert_eq!(s, "::");
    }

    #[test]
    fn origin_type_any_to_str() {
        let s: &str = OriginType::Any.into();
        assert_eq!(s, "0.0.0.0");
    }

    // ── RemoteUiConfig ──────────────────────────────────────────────────────

    #[test]
    fn config_default_values() {
        let cfg = RemoteUiConfig::default();
        assert!(matches!(cfg.allowed_origin, OriginType::Localhost));
        assert!(cfg.port.is_none());
        assert!(cfg.enable_log);
    }

    #[test]
    fn config_enable_log() {
        let cfg = RemoteUiConfig::default().enable_log();
        assert!(cfg.enable_log);
    }

    #[test]
    fn config_disable_log() {
        let cfg = RemoteUiConfig::default().disable_log();
        assert!(!cfg.enable_log);
    }

    #[test]
    fn config_set_allowed_origin() {
        let cfg = RemoteUiConfig::default().set_allowed_origin(OriginType::Any);
        assert!(matches!(cfg.allowed_origin, OriginType::Any));
        let cfg = cfg.set_allowed_origin(OriginType::Direct);
        assert!(matches!(cfg.allowed_origin, OriginType::Direct));
    }

    #[test]
    fn config_set_port_some() {
        let cfg = RemoteUiConfig::default().set_port(Some(9090));
        assert_eq!(cfg.port, Some(9090));
    }

    #[test]
    fn config_set_port_none() {
        let cfg = RemoteUiConfig::default()
            .set_port(Some(8080))
            .set_port(None);
        assert!(cfg.port.is_none());
    }

    #[test]
    fn config_getters() {
        let cfg = RemoteUiConfig::default()
            .set_allowed_origin(OriginType::Any)
            .set_port(Some(9090));
        assert!(matches!(cfg.get_allowed_origin(), OriginType::Any));
        assert_eq!(cfg.get_port(), Some(9090));
    }

    #[test]
    fn config_builder_chain() {
        let cfg = RemoteUiConfig::default()
            .set_port(Some(9090))
            .set_allowed_origin(OriginType::Direct)
            .disable_log();
        assert_eq!(cfg.get_port(), Some(9090));
        assert!(matches!(cfg.get_allowed_origin(), OriginType::Direct));
        assert!(!cfg.enable_log);
    }

    // ── RpcResponseStatus ──────────────────────────────────────────────────

    #[test]
    fn rpc_status_success_to_str() {
        let s: &str = RpcResponseStatus::Success.into();
        assert_eq!(s, "success");
    }

    #[test]
    fn rpc_status_error_to_str() {
        let s: &str = RpcResponseStatus::Error.into();
        assert_eq!(s, "error");
    }

    #[test]
    fn rpc_status_invalid_to_str() {
        let s: &str = RpcResponseStatus::Invalid.into();
        assert_eq!(s, "invalid");
    }

    #[test]
    fn rpc_status_from_str_success() {
        let status: RpcResponseStatus = "success".into();
        assert!(matches!(status, RpcResponseStatus::Success));
    }

    #[test]
    fn rpc_status_from_str_error() {
        let status: RpcResponseStatus = "error".into();
        assert!(matches!(status, RpcResponseStatus::Error));
    }

    #[test]
    fn rpc_status_from_str_unknown_defaults_to_invalid() {
        let status: RpcResponseStatus = "unknown".into();
        assert!(matches!(status, RpcResponseStatus::Invalid));
    }

    #[test]
    fn rpc_status_roundtrip() {
        for (input, expected_str, expected_variant) in [
            (
                RpcResponseStatus::Success,
                "success",
                RpcResponseStatus::Success,
            ),
            (RpcResponseStatus::Error, "error", RpcResponseStatus::Error),
            (
                RpcResponseStatus::Invalid,
                "invalid",
                RpcResponseStatus::Invalid,
            ),
        ] {
            let s: &str = input.into();
            assert_eq!(s, expected_str);
            let back: RpcResponseStatus = s.into();
            assert!(std::mem::discriminant(&back) == std::mem::discriminant(&expected_variant));
        }
    }

    // ── WsPayload ──────────────────────────────────────────────────────────

    #[test]
    fn ws_payload_deserialize_full() {
        let json =
            r#"{"id": 42, "cmd": "my_command", "args": {"key": "value"}, "option": {"opt": true}}"#;
        let payload: WsPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.id, 42);
        assert_eq!(payload.cmd, "my_command");
        assert_eq!(payload.args, Some(serde_json::json!({"key": "value"})));
        assert_eq!(payload.option, Some(serde_json::json!({"opt": true})));
    }

    #[test]
    fn ws_payload_deserialize_null_args() {
        let json = r#"{"id": 1, "cmd": "no_args", "args": null, "option": null}"#;
        let payload: WsPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.id, 1);
        assert_eq!(payload.cmd, "no_args");
        assert_eq!(payload.args, None);
        assert_eq!(payload.option, None);
    }

    #[test]
    fn ws_payload_deserialize_missing_option() {
        let json = r#"{"id": 7, "cmd": "test", "args": [1, 2, 3]}"#;
        let payload: WsPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.id, 7);
        assert_eq!(payload.cmd, "test");
        assert_eq!(payload.args, Some(serde_json::json!([1, 2, 3])));
        assert!(payload.option.is_none());
    }

    // ── RemoteUiEvent ──────────────────────────────────────────────────────

    #[test]
    fn remote_ui_event_serialize() {
        let event = RemoteUiEvent {
            event_name: "test_event".into(),
            window_label: Some("main".into()),
            payload: serde_json::json!({"key": 42}),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("test_event"));
        assert!(json.contains("main"));
        assert!(json.contains("42"));
    }

    #[test]
    fn remote_ui_event_serialize_no_window() {
        let event = RemoteUiEvent {
            event_name: "no_window".into(),
            window_label: None,
            payload: "simple".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("no_window"));
        assert!(!json.contains("windowLabel"));
    }

    // ── EmitRequest / EmitResponse ─────────────────────────────────────────

    #[test]
    fn emit_request_deserialize_some() {
        let json = r#"{"value": "hello"}"#;
        let req: EmitRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.value, Some("hello".into()));
    }

    #[test]
    fn emit_request_deserialize_null() {
        let json = r#"{"value": null}"#;
        let req: EmitRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.value, None);
    }

    #[test]
    fn emit_response_default() {
        let resp = EmitResponse::default();
        assert_eq!(resp.value, None);
    }

    #[test]
    fn emit_response_roundtrip() {
        let resp = EmitResponse {
            value: Some("ok".into()),
        };
        let json = serde_json::to_string(&resp).unwrap();
        let back: EmitResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(back.value, Some("ok".into()));
    }
}
