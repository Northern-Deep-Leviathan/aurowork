//! Spreadsheet cache and workbook I/O gateway.
//!
//! All reads, writes, and evictions of `.xlsx` workbooks flow through
//! [`WorkbookCache`]. No other module should call `umya_spreadsheet::reader`
//! or `umya_spreadsheet::writer` directly.

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::commands::fs::{atomic_write_with_lock, get_revision, FileRevision};

// ── Error model ──

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "code")]
pub enum SheetError {
    #[error("{message}")]
    NotFound { message: String },
    #[error("{message}")]
    PermissionDenied { message: String },
    #[error("{message}")]
    RevisionMismatch { message: String },
    #[error("{message}")]
    FileLocked { message: String },
    #[error("{message}")]
    CacheEvicted { message: String },
    #[error("{message}")]
    ParseError { message: String },
    #[error("{message}")]
    WriteFailed { message: String },
    #[error("{message}")]
    InvalidRequest { message: String },
    #[error("{message}")]
    Internal { message: String },
}

impl From<std::io::Error> for SheetError {
    fn from(e: std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::NotFound => SheetError::NotFound { message: e.to_string() },
            std::io::ErrorKind::PermissionDenied => {
                SheetError::PermissionDenied { message: e.to_string() }
            }
            _ => SheetError::Internal { message: e.to_string() },
        }
    }
}
