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
