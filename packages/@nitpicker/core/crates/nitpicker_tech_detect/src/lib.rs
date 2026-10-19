//! Structural technology detection: which frontend frameworks a page's HTML
//! (or a JS resource's leading bytes) shows fingerprints of.
//!
//! Input is UTF-8 bytes — what `Buffer.from(text, 'utf8')` produces — and
//! the output must equal what the JS regular expressions in
//! `@nitpicker/archive` (kept as a parity oracle in
//! `src/meta/technologies/structural-signal-definitions.ts`) stored into
//! existing archives' `technology_signals`: the same signals in the same
//! order, with the same evidence.

#![forbid(unsafe_code)]

mod definitions;
mod match_signals;
mod truncate_evidence;

pub use definitions::{SIGNAL_DEFINITIONS, SignalDefinition};
pub use match_signals::{TechnologySignal, match_html_signals, match_js_license_comment_signal};
pub use truncate_evidence::{EVIDENCE_MAX_UTF16_UNITS, truncate_evidence};
