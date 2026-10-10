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

#![forbid(unsafe_code)]

mod compute_body_hash;
mod extract_body;
mod mask_dynamic_ids;
mod normalize_url_like_strings;

pub use compute_body_hash::compute_body_hash;
pub use extract_body::extract_body;
pub use mask_dynamic_ids::mask_dynamic_ids;
pub use normalize_url_like_strings::normalize_url_like_strings;
