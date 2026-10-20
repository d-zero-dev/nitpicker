//! Byte-level scans over stored HTML snapshots.
//!
//! Every function here takes the HTML as UTF-8 bytes — exactly what
//! `Buffer.from(html, 'utf8')` produces on the JS side — and never builds an
//! intermediate UTF-16 string. The patterns are compiled with Unicode mode
//! off (`(?-u)`) because the values they produce are persisted and must stay
//! byte-identical to the values JavaScript computed into existing archives
//! (the JS stages survive as a parity oracle in `@nitpicker/archive`'s
//! `src/body-hash/`): JS regular
//! expressions without the `u` flag match `[a-z]` / `\w` under `i` against
//! ASCII only, whereas Rust's Unicode mode would also accept U+017F (ſ) and
//! U+212A (Kelvin sign) and shift token boundaries.
//!
//! `compute_body_hash` runs extraction, normalization and masking as one
//! pass that streams into the hasher. `normalize_url_like_strings` and
//! `mask_dynamic_ids` are the same stages one at a time: nothing in the
//! addon calls them, and they stay public as the reference the fused pass
//! is checked against.
//!
//! `scan_snapshots` and `html_matches_selector` answer `query match-selector`:
//! whether a stored document has an element matching a CSS selector list,
//! judged on the serialized markup by the interpretation rules in
//! `docs/query.md` (not by an HTML parser — see `tag_tokenizer`). Unlike the
//! body hash nothing here is persisted, so there is no golden: that contract
//! is the answer, and what the matcher is checked against is the DOM the
//! markup was serialized from (`@nitpicker/query`'s oracle spec). Case folding
//! is ASCII-only throughout, as HTML's tag and attribute names are.

#![forbid(unsafe_code)]

mod ascii;
mod compute_body_hash;
mod decode_serialized_attribute_value;
mod element;
mod extract_body;
mod hash_normalized_masked;
mod html_matches_selector;
mod mask_dynamic_ids;
mod matches_attribute_test;
mod matches_compound;
mod matches_nth;
mod normalize_url_like_strings;
mod passes_ordered_prefilter;
mod run_direct_match;
mod run_selector_state_machine;
mod scan_snapshots;
mod selector_plan;
mod start_tag_attributes;
mod tag_tokenizer;

pub use compute_body_hash::compute_body_hash;
pub use decode_serialized_attribute_value::decode_serialized_attribute_value;
pub use extract_body::extract_body;
pub use html_matches_selector::{HtmlMatchOutcome, html_matches_selector};
pub use mask_dynamic_ids::mask_dynamic_ids;
pub use matches_nth::matches_nth;
pub use normalize_url_like_strings::normalize_url_like_strings;
pub use passes_ordered_prefilter::passes_ordered_prefilter;
pub use scan_snapshots::{ScanError, SnapshotCodec, StoredSnapshot, scan_snapshots};
pub use selector_plan::{
	Alternative, AttributeOperator, AttributeTest, Combinator, Compound, Conditions, NthTest,
	SelectorPlan,
};
