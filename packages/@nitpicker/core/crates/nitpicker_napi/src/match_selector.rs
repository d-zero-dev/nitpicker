//! `query match-selector`'s judging (`nitpicker_html_scan`) as JS calls it.
//!
//! JS validates the selector and reads the stored snapshots from the
//! archive's database; the batch it hands over is decoded (zstd), read as
//! markup and judged here. A batch is judged on the addon's thread pool
//! (`executor`) and the call returns a promise, so neither Node's main thread
//! nor libuv's small worker pool is held while it runs.

use std::panic::{AssertUnwindSafe, catch_unwind};

use napi::bindgen_prelude::{Object, Uint8Array};
use napi::{Env, Error, Result, Status};
use napi_derive::napi;
use nitpicker_html_scan::{
	Alternative, AttributeOperator, AttributeTest, Combinator, Compound, Conditions,
	HtmlMatchOutcome, NthTest, ScanFailure, SelectorPlan, StoredSnapshot,
};

use crate::native_executor::{NativeCancelToken, cancelled_error, shared_executor};
use crate::slice_by_offsets::slice_by_offsets;
use crate::snapshot_codecs::to_snapshot_codecs;

/// One attribute condition of a selector.
#[napi(object)]
pub struct AttributeTestInput {
	/// Lower-cased attribute name.
	pub name: String,
	/// `exists`, `equals`, `includes`, `dash`, `prefix`, `suffix` or `substring`.
	pub operator: String,
	pub value: String,
	pub ignore_case: bool,
}

/// An `An+B` position test.
#[napi(object)]
pub struct NthTestInput {
	/// `child` or `of-type`.
	pub kind: String,
	pub a: f64,
	pub b: f64,
}

/// The conditions inside `:not(...)`.
#[napi(object)]
pub struct NegatedCompoundInput {
	pub tag: Option<String>,
	pub attributes: Vec<AttributeTestInput>,
	pub nth: Vec<NthTestInput>,
}

/// One compound selector.
#[napi(object)]
pub struct CompoundInput {
	pub tag: Option<String>,
	pub attributes: Vec<AttributeTestInput>,
	pub nth: Vec<NthTestInput>,
	pub negations: Vec<NegatedCompoundInput>,
}

/// One comma alternative of the selector list.
#[napi(object)]
pub struct AlternativeInput {
	pub compounds: Vec<CompoundInput>,
	/// `descendant` or `child`, one fewer than `compounds`.
	pub combinators: Vec<String>,
	pub prefilter_literals: Option<Vec<String>>,
	/// Whether one start tag decides the alternative.
	pub direct: bool,
}

/// A validated selector list.
#[napi(object)]
pub struct SelectorPlanInput {
	pub alternatives: Vec<AlternativeInput>,
	pub needs_child_index: bool,
	pub needs_type_index: bool,
}

/// The verdict on one document and which stages produced it.
#[napi(object)]
pub struct HtmlMatchOutcomeOutput {
	pub matched: bool,
	pub prefiltered: bool,
	pub tokenized: bool,
	pub elements_visited: u32,
}

/// The flag bits of one snapshot's outcome in a batch result.
const MATCHED: u8 = 1;
const PREFILTERED: u8 = 2;
const TOKENIZED: u8 = 4;

fn invalid(reason: String) -> Error {
	Error::new(Status::InvalidArg, reason)
}

fn to_operator(name: &str) -> Result<AttributeOperator> {
	Ok(match name {
		"exists" => AttributeOperator::Exists,
		"equals" => AttributeOperator::Equals,
		"includes" => AttributeOperator::Includes,
		"dash" => AttributeOperator::Dash,
		"prefix" => AttributeOperator::Prefix,
		"suffix" => AttributeOperator::Suffix,
		"substring" => AttributeOperator::Substring,
		other => return Err(invalid(format!("unknown attribute operator: {other}"))),
	})
}

fn to_attribute(input: AttributeTestInput) -> Result<AttributeTest> {
	Ok(AttributeTest {
		operator: to_operator(&input.operator)?,
		name: input.name,
		value: input.value,
		ignore_case: input.ignore_case,
	})
}

fn to_nth(input: &NthTestInput) -> Result<NthTest> {
	let of_type = match input.kind.as_str() {
		"child" => false,
		"of-type" => true,
		other => return Err(invalid(format!("unknown position test kind: {other}"))),
	};
	Ok(NthTest {
		of_type,
		a: input.a,
		b: input.b,
	})
}

fn to_conditions(
	tag: Option<String>,
	attributes: Vec<AttributeTestInput>,
	nth: &[NthTestInput],
) -> Result<Conditions> {
	Ok(Conditions {
		tag,
		attributes: attributes
			.into_iter()
			.map(to_attribute)
			.collect::<Result<_>>()?,
		nth: nth.iter().map(to_nth).collect::<Result<_>>()?,
	})
}

fn to_compound(input: CompoundInput) -> Result<Compound> {
	let negations = input
		.negations
		.into_iter()
		.map(|negation| to_conditions(negation.tag, negation.attributes, &negation.nth))
		.collect::<Result<_>>()?;
	Ok(Compound {
		conditions: to_conditions(input.tag, input.attributes, &input.nth)?,
		negations,
	})
}

fn to_alternative(input: AlternativeInput) -> Result<Alternative> {
	let compounds: Vec<Compound> = input
		.compounds
		.into_iter()
		.map(to_compound)
		.collect::<Result<_>>()?;
	if compounds.is_empty() || compounds.len() > 30 {
		return Err(invalid(
			"an alternative needs between 1 and 30 compounds".to_owned(),
		));
	}
	let combinators: Vec<Combinator> = input
		.combinators
		.iter()
		.map(|name| match name.as_str() {
			"descendant" => Ok(Combinator::Descendant),
			"child" => Ok(Combinator::Child),
			other => Err(invalid(format!("unknown combinator: {other}"))),
		})
		.collect::<Result<_>>()?;
	if combinators.len() + 1 != compounds.len() {
		return Err(invalid(
			"an alternative needs one combinator fewer than compounds".to_owned(),
		));
	}
	if input.direct {
		// A direct alternative is judged on one start tag: only its first compound
		// is read, and no sibling position is counted.
		let has_position_test = compounds.iter().any(|compound| {
			!compound.conditions.nth.is_empty()
				|| compound.negations.iter().any(|n| !n.nth.is_empty())
		});
		if compounds.len() != 1 || has_position_test {
			return Err(invalid(
				"a direct alternative is one compound without position tests".to_owned(),
			));
		}
	}
	Ok(Alternative {
		compounds,
		combinators,
		prefilter_literals: input
			.prefilter_literals
			.map(|literals| literals.into_iter().map(String::into_bytes).collect()),
		direct: input.direct,
	})
}

fn to_plan(input: SelectorPlanInput) -> Result<SelectorPlan> {
	Ok(SelectorPlan {
		alternatives: input
			.alternatives
			.into_iter()
			.map(to_alternative)
			.collect::<Result<_>>()?,
		needs_child_index: input.needs_child_index,
		needs_type_index: input.needs_type_index,
	})
}

fn flags(outcome: HtmlMatchOutcome) -> u8 {
	let mut bits = 0;
	if outcome.matched {
		bits |= MATCHED;
	}
	if outcome.prefiltered {
		bits |= PREFILTERED;
	}
	if outcome.tokenized {
		bits |= TOKENIZED;
	}
	bits
}

/// Judges one document (UTF-8) against a selector plan.
///
/// Synchronous: one document is cheap, and this is the entry the tests and
/// the stage-comparison bench use.
///
/// # Errors
///
/// `InvalidArg` when the plan is malformed (an unknown operator, kind or
/// combinator, or compounds and combinators that do not pair up).
#[napi(catch_unwind)]
pub fn match_selector_html(plan: SelectorPlanInput, html: &[u8]) -> Result<HtmlMatchOutcomeOutput> {
	// Read as UTF-8 with invalid sequences replaced, as a batch reads each snapshot.
	let text = String::from_utf8_lossy(html);
	let outcome = nitpicker_html_scan::html_matches_selector(&to_plan(plan)?, text.as_bytes());
	Ok(HtmlMatchOutcomeOutput {
		matched: outcome.matched,
		prefiltered: outcome.prefiltered,
		tokenized: outcome.tokenized,
		elements_visited: outcome.elements_visited,
	})
}

/// Judges a batch of stored snapshots against a selector plan.
///
/// `bodies` holds the stored bytes back to back, `offsets` the `n + 1`
/// positions that cut it into `n` snapshots, and `codecs` one byte per
/// snapshot: `0` stored as they are, `1` zstd. A zstd snapshot may
/// decompress to at most `max_decoded_bytes`. Resolves with one byte per
/// snapshot, in order: bit 0 matched, bit 1 rejected by the prefilter alone,
/// bit 2 judged on the open-element stack.
///
/// The work runs on the addon's thread pool (`executor`) after this call
/// returns — behind any call already running when the concurrency limit is
/// reached — and reads `bodies` in place: the caller must not write to that
/// buffer until the promise settles (the JS wrapper packs a fresh one for
/// every call).
///
/// `cancel_token`, once raised, stops the judging at the next snapshot or
/// within the next mebibyte of a decompression under way (a call still
/// queued ends when its turn comes) and rejects with code `Cancelled`.
///
/// # Errors
///
/// `InvalidArg` when the plan, the offsets or a codec is malformed, or an
/// executor setting is invalid. The promise rejects when a snapshot cannot be
/// decoded (corrupt, or past `max_decoded_bytes`), when the call was
/// cancelled, or when judging panicked; a snapshot is never silently judged
/// "no match".
#[napi(ts_return_type = "Promise<Uint8Array>")]
pub fn match_selector_snapshots<'env>(
	env: &'env Env,
	plan: SelectorPlanInput,
	bodies: Uint8Array,
	offsets: &[u32],
	codecs: &[u8],
	max_decoded_bytes: u32,
	cancel_token: Option<&NativeCancelToken>,
) -> Result<Object<'env>> {
	let executor = shared_executor()?;
	let cancelled = NativeCancelToken::flag_of(cancel_token);
	let plan = to_plan(plan)?;
	let codecs = to_snapshot_codecs(codecs)?;
	let cut = slice_by_offsets(&bodies, offsets)?;
	if cut.len() != codecs.len() {
		return Err(invalid("every snapshot needs exactly one codec".to_owned()));
	}
	let ranges: Vec<std::ops::Range<usize>> = offsets
		.windows(2)
		.map(|pair| pair[0] as usize..pair[1] as usize)
		.collect();

	let (deferred, promise) = env.create_deferred()?;
	executor.submit(move || {
		let outcome = catch_unwind(AssertUnwindSafe(|| {
			let snapshots: Vec<StoredSnapshot> = ranges
				.into_iter()
				.zip(&codecs)
				.map(|(range, &codec)| StoredSnapshot {
					body: &bodies[range],
					codec,
				})
				.collect();
			nitpicker_html_scan::scan_snapshots(
				&plan,
				&snapshots,
				max_decoded_bytes as usize,
				cancelled.raised(),
			)
		}));
		deferred.resolve(move |_| match outcome {
			Ok(Ok(outcomes)) => Ok(Uint8Array::new(
				outcomes.into_iter().map(flags).collect::<Vec<u8>>(),
			)),
			Ok(Err(ScanFailure::Cancelled)) => Err(cancelled_error("match-selector judging")),
			Ok(Err(error)) => Err(Error::new(Status::GenericFailure, error.to_string())),
			Err(_) => Err(Error::new(
				Status::GenericFailure,
				"match-selector judging panicked",
			)),
		});
	});
	Ok(promise)
}
