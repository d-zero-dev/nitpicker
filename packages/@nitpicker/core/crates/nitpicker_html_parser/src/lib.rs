//! An HTML parser that reports exactly what htmlparser2 12.0.0 reports.
//!
//! The template classifier's keys are persisted in archives (and pinned by
//! `@nitpicker/archive`'s golden records), and they depend on htmlparser2's
//! reading of the markup: which tags its stack closes implicitly, where it says an
//! element starts and ends (`startIndex` / `endIndex`, quirks included — an
//! opening tag right after `</x >` starts at that tag's `>`), how it decodes
//! a class name. A spec-conformant HTML5 tree builder would disagree with it
//! on malformed markup, so this crate ports htmlparser2's tokenizer and parser
//! instead of using one. Its output is the sequence of `onopentag` /
//! `onclosetag` calls a handler would receive, each with the parser's indices
//! at that moment; handlers are replays over that sequence.
//!
//! Inputs are `&str` (UTF-8). Indices are byte offsets where htmlparser2's
//! are UTF-16 offsets: see `tokenizer.rs` for why the two agree position by
//! position.

#![forbid(unsafe_code)]

mod entity_decoder;
mod html_decode_tree;
mod js_lower_case;
mod parser;
mod tag_name;
mod tokenizer;

pub use js_lower_case::to_lower_case_js;
pub use parser::{AttributeValue, Attributes, Document, Event, EventKind, NO_TAG, NONE, parse};
pub use tag_name::TagName;
