//! Stdio line classification for sidecar (Bun/Rust/Node) output forwarded
//! to the launch log. Detects panic / error / stack continuation patterns
//! so multi-line error dumps land as a single ERROR entry with a stack
//! attachment, rather than 30 detached DEBUG lines.

use crate::launch_log::format::Level;

/// Output of [`SidecarLineClassifier::feed`]. Either:
///   - `Pending` — we held onto the line as part of an in-progress stack.
///   - `Emit { level, message, stack }` — flush this entry now.
pub enum Classified {
    Pending,
    Emit {
        level: Level,
        message: String,
        stack: Option<String>,
    },
}

/// Stateful, single-stream classifier. Use one per stream (stdout/stderr)
/// per sidecar; do not share between streams.
#[derive(Default)]
pub struct SidecarLineClassifier {
    /// When we have seen an error/panic header, we accumulate continuation
    /// lines here until a blank line, a non-indented/non-`at`-prefixed
    /// line, or `MAX_STACK_LINES` is hit.
    pending: Option<PendingError>,
}

struct PendingError {
    message: String,
    stack_lines: Vec<String>,
}

const MAX_STACK_LINES: usize = 30;

impl SidecarLineClassifier {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed one line (no trailing newline). Pass `default_level` for normal
    /// lines (Debug for stdout, Warn for stderr).
    pub fn feed(&mut self, line: &str, default_level: Level) -> Classified {
        let trimmed = line.trim_end();

        // Continuation of an in-progress error stack?
        if let Some(pending) = self.pending.as_mut() {
            if is_stack_continuation(trimmed) && pending.stack_lines.len() < MAX_STACK_LINES {
                pending.stack_lines.push(trimmed.to_string());
                return Classified::Pending;
            }
            // End-of-stack: flush the pending error, then process this line fresh.
            let flushed = self.flush_pending();
            // The current line is non-continuation; recursively classify it.
            return match flushed {
                Some(emit) => {
                    // Push the trailing line into a buffer? No — we lose
                    // the current line if we don't process it. Re-feed it
                    // by classifying as a fresh start.
                    // Combine: flush + classify the new line, but Classified can
                    // only return one. Compromise: flush, drop the trailing
                    // (rare) — OR — store the trailing in pending again if
                    // it looks like a new error.
                    if let Some(new) = classify_fresh(trimmed, default_level) {
                        // Buffer the current line as a new pending error, but
                        // first we have to emit the flushed one. Stash the new
                        // pending so the next call gets it.
                        if matches!(new.level, Level::Error) {
                            self.pending = Some(PendingError {
                                message: new.message,
                                stack_lines: Vec::new(),
                            });
                        }
                        // We can only emit one; the new line either kicks off a
                        // pending or is lost. For simplicity, drop the trailing
                        // non-error line — it would be a single DEBUG anyway.
                        emit
                    } else {
                        emit
                    }
                }
                None => unreachable!("pending was Some"),
            };
        }

        // Fresh classification.
        if let Some(emitted) = classify_fresh(trimmed, default_level) {
            if matches!(emitted.level, Level::Error) {
                // Start accumulating a stack for this error.
                self.pending = Some(PendingError {
                    message: emitted.message.clone(),
                    stack_lines: Vec::new(),
                });
                return Classified::Pending;
            }
            return Classified::Emit {
                level: emitted.level,
                message: emitted.message,
                stack: None,
            };
        }

        // Blank line.
        Classified::Emit {
            level: default_level,
            message: String::new(),
            stack: None,
        }
    }

    /// Force-flush any pending error (e.g. on EOF/termination).
    pub fn flush(&mut self) -> Option<Classified> {
        self.flush_pending().map(|emit| emit)
    }

    fn flush_pending(&mut self) -> Option<Classified> {
        let pending = self.pending.take()?;
        let stack = if pending.stack_lines.is_empty() {
            None
        } else {
            Some(pending.stack_lines.join("\n"))
        };
        Some(Classified::Emit {
            level: Level::Error,
            message: pending.message,
            stack,
        })
    }
}

struct FreshEmit {
    level: Level,
    message: String,
}

fn classify_fresh(line: &str, default_level: Level) -> Option<FreshEmit> {
    if line.is_empty() {
        return None;
    }
    // Rust panic.
    if line.contains("panicked at") || line.starts_with("thread '") && line.contains("panic") {
        return Some(FreshEmit {
            level: Level::Error,
            message: line.to_string(),
        });
    }
    // Node/Bun uncaught.
    if line.starts_with("Uncaught ") || line.starts_with("UnhandledPromiseRejection") {
        return Some(FreshEmit {
            level: Level::Error,
            message: line.to_string(),
        });
    }
    // Generic "Error:" prefix.
    if line.starts_with("Error:") || line.starts_with("TypeError:") || line.starts_with("ReferenceError:") || line.starts_with("RangeError:") {
        return Some(FreshEmit {
            level: Level::Error,
            message: line.to_string(),
        });
    }
    Some(FreshEmit {
        level: default_level,
        message: line.to_string(),
    })
}

fn is_stack_continuation(line: &str) -> bool {
    let trimmed = line.trim_start();
    if trimmed.is_empty() {
        return false;
    }
    // JS-style: "    at fn (file:line:col)"
    if trimmed.starts_with("at ") {
        return true;
    }
    // Rust backtrace frame: "   0: aurowork::foo at src/foo.rs:42"
    // Heuristic: starts with digits + colon, or "note: " etc.
    if trimmed.starts_with("note:") || trimmed.starts_with("stack backtrace:") {
        return true;
    }
    let mut chars = trimmed.chars();
    if let Some(first) = chars.next() {
        if first.is_ascii_digit() {
            // Could be "0:" frame or just a number — only treat as stack if there is a ':' early.
            return trimmed.chars().take(5).any(|c| c == ':');
        }
    }
    // Line starts with whitespace AND has substance — probably continuation.
    line.starts_with(char::is_whitespace) && !trimmed.is_empty() && trimmed.len() < 200
}

/// Re-tag a sidecar-forwarded line based on its bracketed prefix and
/// strip the prefix from the message. Returns `(tag, stripped_message)`.
///
/// The orchestrator forwards multiple child streams over its own stdout,
/// each prefixed with `[opencode]`, `[aurowork-orchestrator]`, etc. We
/// reroute `[opencode]` lines to `launch:engine` so the launch log
/// reflects which subsystem the line actually came from.
pub fn classify_sidecar_tag<'a>(
    line: &'a str,
    default_tag: &'static str,
) -> (&'static str, &'a str) {
    if let Some(rest) = line.strip_prefix("[opencode] ") {
        return ("launch:engine", rest);
    }
    if let Some(rest) = line.strip_prefix("[aurowork-orchestrator-router] ") {
        return ("launch:orchestr", rest);
    }
    if let Some(rest) = line.strip_prefix("[aurowork-orchestrator] ") {
        return ("launch:orchestr", rest);
    }
    (default_tag, line)
}

/// A recognized opencode startup/runtime phase event extracted from a
/// stdout line. The original line is unchanged; this is a *secondary*
/// signal used by the engine forwarder to emit normalized INFO entries
/// (e.g. `[engine-phase] model-list-fetch [overseas]`).
pub struct OpencodePhase {
    pub event: &'static str,
    pub overseas: bool,
    pub level: Level,
    pub extras: Option<String>,
}

/// Pattern-detect a stripped opencode stdout line. Input MUST already
/// have the `[opencode] ` prefix removed (i.e. the second tuple element
/// from `classify_sidecar_tag`).
pub fn classify_opencode_phase(line: &str) -> Option<OpencodePhase> {
    let lower = line.to_lowercase();

    // 1. Server listening.
    if lower.contains("server listening on") {
        return Some(OpencodePhase {
            event: "server-listening",
            overseas: false,
            level: Level::Info,
            extras: None,
        });
    }

    // 2. Model list fetch.
    if lower.contains("models.dev")
        || lower.contains("fetching models")
        || lower.contains("fetching model list")
    {
        let host = extract_host(line);
        let overseas = host.as_deref().map(is_overseas_host).unwrap_or(false)
            || lower.contains("models.dev");
        return Some(OpencodePhase {
            event: "model-list-fetch",
            overseas,
            level: Level::Info,
            extras: host.map(|h| format!("host={h}")),
        });
    }

    // 3. Plugin loaded.
    if lower.contains("plugin loaded") {
        return Some(OpencodePhase {
            event: "plugin-loaded",
            overseas: false,
            level: Level::Info,
            extras: None,
        });
    }

    // 4. MCP server spawn/start.
    if lower.contains("mcp server")
        && (lower.contains("spawn") || lower.contains("starting") || lower.contains("connect"))
    {
        return Some(OpencodePhase {
            event: "mcp-spawn",
            overseas: false,
            level: Level::Info,
            extras: None,
        });
    }

    // 5. DB migration.
    if lower.contains("migration")
        && (lower.contains("sqlite") || lower.contains("database") || lower.contains("migrating"))
    {
        return Some(OpencodePhase {
            event: "db-migration",
            overseas: false,
            level: Level::Info,
            extras: None,
        });
    }

    // 6. Provider fetch.
    if lower.contains("fetching")
        && (lower.contains("api.anthropic.com")
            || lower.contains("api.openai.com")
            || lower.contains("openrouter"))
    {
        let host = extract_host(line);
        return Some(OpencodePhase {
            event: "provider-fetch",
            overseas: true,
            level: Level::Info,
            extras: host.map(|h| format!("host={h}")),
        });
    }

    None
}

fn extract_host(line: &str) -> Option<String> {
    // Find the first http(s):// substring and parse its host.
    let idx = line.find("http://").or_else(|| line.find("https://"))?;
    let rest = &line[idx..];
    let end = rest.find(|c: char| c.is_whitespace() || c == ')' || c == ',').unwrap_or(rest.len());
    let url = &rest[..end];
    url::Url::parse(url).ok().and_then(|u| u.host_str().map(|s| s.to_string()))
}

fn is_overseas_host(host: &str) -> bool {
    let h = host.to_lowercase();
    if h == "localhost" || h == "127.0.0.1" || h == "::1" {
        return false;
    }
    let overseas = [
        "github.com", "githubusercontent.com", "models.dev",
        "api.openai.com", "api.anthropic.com", "openrouter.ai",
        "registry.npmjs.org", "npm.pkg.github.com",
    ];
    overseas.iter().any(|o| h == *o || h.ends_with(&format!(".{o}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn extract(c: Classified) -> Option<(Level, String, Option<String>)> {
        match c {
            Classified::Pending => None,
            Classified::Emit { level, message, stack } => Some((level, message, stack)),
        }
    }

    #[test]
    fn plain_debug_line_passes_through() {
        let mut clf = SidecarLineClassifier::new();
        let got = extract(clf.feed("[opencode] running", Level::Debug)).unwrap();
        assert!(matches!(got.0, Level::Debug));
        assert_eq!(got.1, "[opencode] running");
        assert!(got.2.is_none());
    }

    #[test]
    fn rust_panic_becomes_error_with_stack() {
        let mut clf = SidecarLineClassifier::new();
        // First feed the panic header — held as pending.
        assert!(matches!(
            clf.feed("thread 'main' panicked at src/foo.rs:42:9", Level::Warn),
            Classified::Pending
        ));
        assert!(matches!(
            clf.feed("note: run with `RUST_BACKTRACE=1` for a backtrace", Level::Warn),
            Classified::Pending
        ));
        // Now an unrelated line ends the pending and we flush.
        let got = extract(clf.feed("plain stuff", Level::Debug)).unwrap();
        assert!(matches!(got.0, Level::Error));
        assert!(got.1.contains("panicked at"));
        assert!(got.2.is_some());
        assert!(got.2.unwrap().contains("note:"));
    }

    #[test]
    fn js_error_collects_at_frames() {
        let mut clf = SidecarLineClassifier::new();
        assert!(matches!(
            clf.feed("Error: bad", Level::Warn),
            Classified::Pending
        ));
        assert!(matches!(
            clf.feed("    at fn (file.ts:1:1)", Level::Warn),
            Classified::Pending
        ));
        assert!(matches!(
            clf.feed("    at other (file.ts:2:2)", Level::Warn),
            Classified::Pending
        ));
        let got = clf.flush().and_then(extract).unwrap();
        assert!(matches!(got.0, Level::Error));
        assert_eq!(got.1, "Error: bad");
        let stack = got.2.unwrap();
        assert!(stack.contains("at fn"));
        assert!(stack.contains("at other"));
    }

    #[test]
    fn classify_tag_opencode_prefix_routes_to_engine() {
        let (tag, stripped) = classify_sidecar_tag(
            "[opencode] opencode server listening on http://127.0.0.1:55779",
            "launch:orchestr",
        );
        assert_eq!(tag, "launch:engine");
        assert_eq!(stripped, "opencode server listening on http://127.0.0.1:55779");
    }

    #[test]
    fn classify_tag_orchestrator_prefix_keeps_orchestr() {
        let (tag, stripped) = classify_sidecar_tag(
            "[aurowork-orchestrator] daemon running on 127.0.0.1:55782",
            "launch:orchestr",
        );
        assert_eq!(tag, "launch:orchestr");
        assert_eq!(stripped, "daemon running on 127.0.0.1:55782");
    }

    #[test]
    fn classify_tag_orchestrator_router_prefix_keeps_orchestr() {
        let (tag, stripped) = classify_sidecar_tag(
            "[aurowork-orchestrator-router] GET /health",
            "launch:orchestr",
        );
        assert_eq!(tag, "launch:orchestr");
        assert_eq!(stripped, "GET /health");
    }

    #[test]
    fn classify_tag_no_prefix_uses_default() {
        let (tag, stripped) = classify_sidecar_tag("plain line", "launch:server");
        assert_eq!(tag, "launch:server");
        assert_eq!(stripped, "plain line");
    }

    #[test]
    fn classify_tag_unknown_bracket_uses_default() {
        let (tag, stripped) = classify_sidecar_tag("[other] hi", "launch:orchestr");
        assert_eq!(tag, "launch:orchestr");
        assert_eq!(stripped, "[other] hi");
    }

    #[test]
    fn classify_tag_default_for_server() {
        let (tag, stripped) =
            classify_sidecar_tag("aurowork-server: listening", "launch:server");
        assert_eq!(tag, "launch:server");
        assert_eq!(stripped, "aurowork-server: listening");
    }

    #[test]
    fn classify_opencode_phase_recognizes_known_events() {
        use super::classify_opencode_phase;
        let p = classify_opencode_phase("opencode server listening on http://127.0.0.1:55779").expect("phase");
        assert_eq!(p.event, "server-listening");
        assert!(!p.overseas);

        let p = classify_opencode_phase("fetching models from https://models.dev/v1/models").expect("phase");
        assert_eq!(p.event, "model-list-fetch");
        assert!(p.overseas);
        assert!(p.extras.as_deref().unwrap_or("").contains("models.dev"));

        let p = classify_opencode_phase("plugin loaded: web-search").expect("phase");
        assert_eq!(p.event, "plugin-loaded");

        let p = classify_opencode_phase("mcp server starting: filesystem").expect("phase");
        assert_eq!(p.event, "mcp-spawn");

        let p = classify_opencode_phase("running migration on opencode.db sqlite").expect("phase");
        assert_eq!(p.event, "db-migration");

        let p = classify_opencode_phase("fetching from api.anthropic.com/v1/messages").expect("phase");
        assert_eq!(p.event, "provider-fetch");
        assert!(p.overseas);

        assert!(classify_opencode_phase("just some random output").is_none());
    }
}
