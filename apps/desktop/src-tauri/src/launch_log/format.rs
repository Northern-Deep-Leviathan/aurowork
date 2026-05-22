//! Pure formatting helpers for launch log lines. No I/O.

use chrono::{DateTime, Local};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

impl Level {
    pub fn as_str(self) -> &'static str {
        match self {
            Level::Trace => "TRACE",
            Level::Debug => "DEBUG",
            Level::Info => "INFO ",
            Level::Warn => "WARN ",
            Level::Error => "ERROR",
        }
    }
}

/// Render a single log line.
///
/// Format: `<ISO 8601 local ts>  <LEVEL>  <tag (padded to 18)>  [pid=N  ]<message>`
/// If `stack` is `Some`, append a second-line indented stack block.
pub fn format_line(
    ts: DateTime<Local>,
    level: Level,
    tag: &str,
    pid: Option<u32>,
    message: &str,
    stack: Option<&str>,
) -> String {
    let ts_str = ts.format("%Y-%m-%dT%H:%M:%S%.3f%:z").to_string();
    let tag_padded = format!("{:<18}", tag);
    let pid_part = match pid {
        Some(pid) => format!("pid={pid}  "),
        None => String::new(),
    };
    let mut out = format!(
        "{ts_str}  {level}  {tag_padded}  {pid_part}{message}\n",
        level = level.as_str()
    );
    if let Some(stack) = stack {
        for line in stack.lines() {
            out.push_str("    └─ ");
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

/// Render the file header written once at aggregator init.
pub fn format_header(
    started_at: DateTime<Local>,
    app_version: &str,
    auro_version: &str,
    platform: &str,
    log_file: &str,
) -> String {
    let ts = started_at.format("%Y-%m-%dT%H:%M:%S%.3f%:z");
    format!(
        "=== AuroWork Launch Log ===\n\
         started_at:    {ts}\n\
         app_version:   {app_version}\n\
         auro_version:  {auro_version}\n\
         platform:      {platform}\n\
         dev_mode:      true\n\
         log_file:      {log_file}\n\
         ============================\n\n"
    )
}

/// Walks the `source()` chain of an error and produces a multi-line
/// stack-style string suitable for the `stack` argument of [`format_line`].
/// Returns `None` if the chain has fewer than one source link.
pub fn format_error_chain(err: &(dyn std::error::Error + 'static)) -> Option<String> {
    let mut chain: Vec<String> = Vec::new();
    let mut current = err.source();
    while let Some(source) = current {
        chain.push(source.to_string());
        current = source.source();
    }
    if chain.is_empty() {
        return None;
    }
    Some(
        chain
            .into_iter()
            .enumerate()
            .map(|(i, line)| format!("caused by [{i}]: {line}"))
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

#[cfg(test)]
mod tests {
    use super::{format_header, format_line, Level};
    use chrono::TimeZone;

    fn fixed_ts() -> chrono::DateTime<chrono::Local> {
        chrono::Local
            .with_ymd_and_hms(2026, 5, 21, 10, 23, 45)
            .unwrap()
    }

    #[test]
    fn format_line_with_pid_and_no_stack() {
        let line = format_line(
            fixed_ts(),
            Level::Info,
            "launch:engine",
            Some(12345),
            "spawning opencode serve",
            None,
        );
        assert!(line.contains("INFO "));
        assert!(line.contains("launch:engine"));
        assert!(line.contains("pid=12345"));
        assert!(line.contains("spawning opencode serve"));
        assert!(line.ends_with('\n'));
        assert!(!line.contains("└─"));
    }

    #[test]
    fn format_line_without_pid_omits_pid_field() {
        let line = format_line(
            fixed_ts(),
            Level::Debug,
            "launch:ui",
            None,
            "theme bootstrapping",
            None,
        );
        assert!(!line.contains("pid="));
    }

    #[test]
    fn format_line_with_stack_renders_indented_block() {
        let line = format_line(
            fixed_ts(),
            Level::Error,
            "launch:server",
            Some(1),
            "port allocation failed",
            Some("frame_a at a.rs:1\nframe_b at b.rs:2"),
        );
        assert!(line.contains("ERROR"));
        assert!(line.contains("└─ frame_a at a.rs:1"));
        assert!(line.contains("└─ frame_b at b.rs:2"));
    }

    #[test]
    fn level_strings_are_five_chars() {
        for l in [Level::Trace, Level::Debug, Level::Info, Level::Warn, Level::Error] {
            assert_eq!(l.as_str().len(), 5, "{:?}", l);
        }
    }

    #[test]
    fn format_error_chain_walks_source_links() {
        use std::error::Error;
        use std::fmt;

        #[derive(Debug)]
        struct Layered {
            msg: &'static str,
            source: Option<Box<dyn Error + 'static>>,
        }
        impl fmt::Display for Layered {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(self.msg)
            }
        }
        impl Error for Layered {
            fn source(&self) -> Option<&(dyn Error + 'static)> {
                self.source.as_deref()
            }
        }

        let bottom = Layered { msg: "io error", source: None };
        let mid = Layered { msg: "parse failed", source: Some(Box::new(bottom)) };
        let top = Layered { msg: "load failed", source: Some(Box::new(mid)) };

        let out = super::format_error_chain(&top).expect("chain");
        assert!(out.contains("caused by [0]: parse failed"));
        assert!(out.contains("caused by [1]: io error"));

        // No source -> None.
        let standalone = Layered { msg: "lonely", source: None };
        assert!(super::format_error_chain(&standalone).is_none());
    }

    #[test]
    fn header_contains_required_fields() {
        let header = format_header(
            fixed_ts(),
            "0.14.1",
            "v0.1.0",
            "macos-aarch64",
            "/tmp/launch.log",
        );
        assert!(header.contains("=== AuroWork Launch Log ==="));
        assert!(header.contains("app_version:   0.14.1"));
        assert!(header.contains("auro_version:  v0.1.0"));
        assert!(header.contains("platform:      macos-aarch64"));
        assert!(header.contains("dev_mode:      true"));
        assert!(header.contains("log_file:      /tmp/launch.log"));
        assert!(header.ends_with("\n\n"));
    }
}
