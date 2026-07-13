// MIT License
// Copyright (c) 2025 DraviaVemal
// See LICENSE file in the root directory.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Wry,
};

pub use models::*;

mod command_registry;
mod error;
mod models;
pub mod remote_ui;
pub use command_registry::CommandRegistry;
pub use error::{Error, Result};
pub use remote_ui::*;

/// Initializes the remote-ui Tauri plugin.
pub fn init() -> TauriPlugin<Wry> {
    Builder::new("remote-ui")
        .setup(|app, api| {
            let remote_ui = remote_ui::init(app, api)?;
            app.manage(remote_ui);
            app.manage(CommandRegistry::new());
            Ok(())
        })
        .build()
}
