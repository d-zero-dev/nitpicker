//! The alias grouping (`nitpicker_url_key`) as JS calls it.

use napi::bindgen_prelude::{Uint8Array, Uint32Array};
use napi::{Error, Result, Status};
use napi_derive::napi;
use nitpicker_url_key::AliasCandidate;

use crate::slice_by_offsets::{slice_by_offsets, slice_utf8_by_offsets};

/// `canonical_url_ids` entry of a page without a `<link rel="canonical">`.
/// A real id equal to this value would be read as "none", so the addon relies
/// on its caller never passing one: the JS wrapper rejects it for every id
/// column (`assertU32Id`).
const NO_CANONICAL: u32 = u32::MAX;

/// What `group_alias_candidates` returns for a candidate that no group
/// elected another representative for.
const NO_REPRESENTATIVE: u32 = u32::MAX;

/// Both alias keys of one URL.
#[napi(object)]
pub struct AliasKeysOutput {
	pub tier_a: String,
	pub tier_b: String,
}

/// The candidates, one entry per page, column by column.
///
/// `urls` holds the URLs back to back as UTF-8, cut by `url_offsets`;
/// `body_hashes` the body hashes back to back, cut by `hash_offsets`, where
/// `hash_present[i]` is `0` for a page without one (its piece is empty).
/// `canonical_url_ids[i]` is `4294967295` for a page without a canonical.
#[napi(object)]
pub struct AliasCandidatesInput {
	pub urls: Uint8Array,
	pub url_offsets: Uint32Array,
	pub url_ids: Uint32Array,
	pub title_text_ids: Uint32Array,
	pub canonical_url_ids: Uint32Array,
	pub body_hashes: Uint8Array,
	pub hash_offsets: Uint32Array,
	pub hash_present: Uint8Array,
}

/// Computes the Tier A and Tier B alias keys of one URL, or `null` for a
/// string that is not an `http(s)` URL.
// napi hands a JS string over by value.
#[allow(clippy::needless_pass_by_value)]
#[napi(catch_unwind)]
#[must_use]
pub fn compute_alias_keys(url: String) -> Option<AliasKeysOutput> {
	nitpicker_url_key::alias_keys(&url).map(|keys| AliasKeysOutput {
		tier_a: keys.tier_a,
		tier_b: keys.tier_b,
	})
}

/// Groups the candidates that are the same page under another URL and elects
/// each group's representative (`nitpicker_url_key::group_alias_candidates`).
///
/// Returns, per candidate, the index of the representative of its group, or
/// `4294967295` when it is its group's representative or in a group of one.
///
/// # Errors
///
/// `InvalidArg` when the columns differ in length, an offsets array is
/// malformed, or a URL is not valid UTF-8.
// napi hands a JS object over by value.
#[allow(clippy::needless_pass_by_value)]
#[napi(catch_unwind)]
pub fn group_alias_candidates(input: AliasCandidatesInput) -> Result<Uint32Array> {
	let urls = slice_utf8_by_offsets(&input.urls, &input.url_offsets)?;
	let hashes = slice_by_offsets(&input.body_hashes, &input.hash_offsets)?;
	let count = urls.len();
	if [
		input.url_ids.len(),
		input.title_text_ids.len(),
		input.canonical_url_ids.len(),
		hashes.len(),
		input.hash_present.len(),
	]
	.iter()
	.any(|&len| len != count)
	{
		return Err(Error::new(
			Status::InvalidArg,
			"every column must have one entry per candidate".to_owned(),
		));
	}

	let candidates: Vec<AliasCandidate<'_>> = (0..count)
		.map(|index| AliasCandidate {
			url: urls[index],
			url_id: input.url_ids[index],
			title_text_id: input.title_text_ids[index],
			canonical_url_id: Some(input.canonical_url_ids[index]).filter(|&id| id != NO_CANONICAL),
			body_hash: (input.hash_present[index] != 0).then_some(hashes[index]),
		})
		.collect();
	let representatives = nitpicker_url_key::group_alias_candidates(&candidates);
	Ok(Uint32Array::new(
		representatives
			.into_iter()
			.map(|representative| representative.unwrap_or(NO_REPRESENTATIVE))
			.collect(),
	))
}
