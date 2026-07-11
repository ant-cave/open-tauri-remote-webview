// MIT License
// Copyright (c) 2025 DraviaVemal
// See LICENSE file in the root directory.

use serde::{ser::Serializer, Serialize};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
  #[error(transparent)]
  Io(#[from] std::io::Error),
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
