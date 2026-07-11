// MIT License
// Copyright (c) 2025 DraviaVemal
// See LICENSE file in the root directory.

use crate::RemoteUi;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Error, EventTarget, Manager, Runtime, WebviewWindow};
use tokio::sync::RwLock;

/// Extension trait that mirrors [`tauri::Emitter`] with the same **synchronous**
/// signatures, but additionally forwards every event to WebSocket-connected
/// browser clients when the remote UI server is active.
///
/// This is a true drop-in replacement for `use tauri::Emitter` — just change
/// the import and all existing `.emit()` / `.emit_to()` / etc. calls continue
/// to work unchanged.
pub trait EmitterExt<R: Runtime> {
    fn emit<S: Serialize + Clone>(&self, event: &str, payload: S) -> Result<(), Error>;
    fn emit_to<I, S>(&self, target: I, event: &str, payload: S) -> Result<(), Error>
    where
        I: Into<EventTarget>,
        S: Serialize + Clone;
    fn emit_str(&self, event: &str, payload: String) -> Result<(), Error>;
    fn emit_str_to<I>(&self, target: I, event: &str, payload: String) -> Result<(), Error>
    where
        I: Into<EventTarget>;
    fn emit_filter<S, F>(&self, event: &str, payload: S, filter: F) -> Result<(), Error>
    where
        S: Serialize + Clone,
        F: Fn(&EventTarget) -> bool;
    fn emit_str_filter<F>(&self, event: &str, payload: String, filter: F) -> Result<(), Error>
    where
        F: Fn(&EventTarget) -> bool;
}

/// Forward an event payload to all WebSocket-connected browser clients via the
/// Remote UI plugin. Uses a non-blocking `try_read()` so it never blocks the
/// calling thread — if the lock is contended the WS forward is skipped (the
/// native IPC emit is unaffected).
fn forward_to_ws<M, R, P>(manager: &M, event: &str, payload: P)
where
    M: Manager<R>,
    R: Runtime,
    P: Serialize + Clone,
{
    if let Some(state) = manager.try_state::<Arc<RwLock<RemoteUi>>>() {
        if let Ok(guard) = state.try_read() {
            if guard.is_rpc_active() {
                let _ = guard.emit(event, payload);
            }
        }
    }
}

// ── AppHandle ──────────────────────────────────────────────────────────────

impl<R: Runtime> EmitterExt<R> for AppHandle<R> {
    fn emit<S: Serialize + Clone>(&self, event: &str, payload: S) -> Result<(), Error> {
        forward_to_ws(self, event, payload.clone());
        Emitter::emit(self, event, payload)
    }

    fn emit_to<I, S>(&self, target: I, event: &str, payload: S) -> Result<(), Error>
    where
        I: Into<EventTarget>,
        S: Serialize + Clone,
    {
        forward_to_ws(self, event, payload.clone());
        Emitter::emit_to(self, target, event, payload)
    }

    fn emit_str(&self, event: &str, payload: String) -> Result<(), Error> {
        forward_to_ws(self, event, payload.clone());
        Emitter::emit_str(self, event, payload)
    }

    fn emit_str_to<I>(&self, target: I, event: &str, payload: String) -> Result<(), Error>
    where
        I: Into<EventTarget>,
    {
        forward_to_ws(self, event, payload.clone());
        Emitter::emit_str_to(self, target, event, payload)
    }

    fn emit_filter<S, F>(&self, event: &str, payload: S, filter: F) -> Result<(), Error>
    where
        S: Serialize + Clone,
        F: Fn(&EventTarget) -> bool,
    {
        forward_to_ws(self, event, payload.clone());
        Emitter::emit_filter(self, event, payload, filter)
    }

    fn emit_str_filter<F>(&self, event: &str, payload: String, filter: F) -> Result<(), Error>
    where
        F: Fn(&EventTarget) -> bool,
    {
        forward_to_ws(self, event, payload.clone());
        Emitter::emit_str_filter(self, event, payload, filter)
    }
}

// ── WebviewWindow ──────────────────────────────────────────────────────────

impl<R: Runtime> EmitterExt<R> for WebviewWindow<R> {
    fn emit<S: Serialize + Clone>(&self, event: &str, payload: S) -> Result<(), Error> {
        forward_to_ws(self, event, payload.clone());
        Emitter::emit(self, event, payload)
    }

    fn emit_to<I, S>(&self, target: I, event: &str, payload: S) -> Result<(), Error>
    where
        I: Into<EventTarget>,
        S: Serialize + Clone,
    {
        forward_to_ws(self, event, payload.clone());
        Emitter::emit_to(self, target, event, payload)
    }

    fn emit_str(&self, event: &str, payload: String) -> Result<(), Error> {
        forward_to_ws(self, event, payload.clone());
        Emitter::emit_str(self, event, payload)
    }

    fn emit_str_to<I>(&self, target: I, event: &str, payload: String) -> Result<(), Error>
    where
        I: Into<EventTarget>,
    {
        forward_to_ws(self, event, payload.clone());
        Emitter::emit_str_to(self, target, event, payload)
    }

    fn emit_filter<S, F>(&self, event: &str, payload: S, filter: F) -> Result<(), Error>
    where
        S: Serialize + Clone,
        F: Fn(&EventTarget) -> bool,
    {
        forward_to_ws(self, event, payload.clone());
        Emitter::emit_filter(self, event, payload, filter)
    }

    fn emit_str_filter<F>(&self, event: &str, payload: String, filter: F) -> Result<(), Error>
    where
        F: Fn(&EventTarget) -> bool,
    {
        forward_to_ws(self, event, payload.clone());
        Emitter::emit_str_filter(self, event, payload, filter)
    }
}
