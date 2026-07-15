// MIT License
// Copyright (c) 2025 DraviaVemal
// See LICENSE file in the root directory.

use serde::{ser::Serializer, Serialize};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[cfg(feature = "ws")]
    #[error("WebSocket send error: {0}")]
    WsSend(String),
    #[error("Plugin state not found")]
    StateNotFound,
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_io_display() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let err = Error::Io(io_err);
        let msg = err.to_string();
        assert!(msg.contains("file not found"), "msg: {msg}");
    }

    #[test]
    fn error_io_from_impl() {
        let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "permission");
        let err: Error = io_err.into();
        assert!(matches!(err, Error::Io(_)));
    }

    #[cfg(feature = "ws")]
    #[test]
    fn error_ws_send_display() {
        let err = Error::WsSend("connection closed".into());
        assert_eq!(err.to_string(), "WebSocket send error: connection closed");
    }

    #[test]
    fn error_state_not_found_display() {
        let err = Error::StateNotFound;
        assert_eq!(err.to_string(), "Plugin state not found");
    }

    #[test]
    fn error_serialize_io() {
        let io_err = std::io::Error::new(std::io::ErrorKind::Other, "oops");
        let err = Error::Io(io_err);
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"oops\"");
    }

    #[cfg(feature = "ws")]
    #[test]
    fn error_serialize_ws_send() {
        let err = Error::WsSend("timeout".into());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"WebSocket send error: timeout\"");
    }

    #[test]
    fn error_serialize_state_not_found() {
        let err = Error::StateNotFound;
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"Plugin state not found\"");
    }

    #[test]
    fn result_type_alias() {
        let ok: Result<i32> = Ok(42);
        assert_eq!(ok.unwrap(), 42);
    }
}
