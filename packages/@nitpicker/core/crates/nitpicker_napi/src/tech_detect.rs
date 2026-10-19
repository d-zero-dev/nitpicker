//! Structural technology detection (`nitpicker_tech_detect`) as JS calls it.
//!
//! Both functions are synchronous: they run once per page (or per JS
//! resource) during a crawl, on the event loop that also drives the
//! browser, so they stay off rayon, and one input is cheap enough that a
//! worker hop would cost more than it saves.

use napi_derive::napi;
use nitpicker_tech_detect::TechnologySignal;

/// One structural signal, every field filled in.
#[napi(object)]
pub struct TechnologySignalOutput {
	pub technology: String,
	pub signal_type: String,
	pub evidence: String,
	pub weight: u32,
	pub category: String,
}

impl From<TechnologySignal> for TechnologySignalOutput {
	fn from(signal: TechnologySignal) -> Self {
		Self {
			technology: signal.technology.to_owned(),
			signal_type: signal.signal_type.to_owned(),
			evidence: signal.evidence,
			weight: signal.weight,
			category: signal.category.to_owned(),
		}
	}
}

/// Matches every structural definition against a page's HTML (UTF-8).
#[napi(catch_unwind)]
#[must_use]
pub fn match_structural_technology_signals(html: &[u8]) -> Vec<TechnologySignalOutput> {
	nitpicker_tech_detect::match_html_signals(html)
		.into_iter()
		.map(TechnologySignalOutput::from)
		.collect()
}

/// Matches the `js-license-comment` definitions against a JS resource's
/// leading bytes (UTF-8), returning the first that occurs.
#[napi(catch_unwind)]
#[must_use]
pub fn match_js_license_comment_signal(script: &[u8]) -> Option<TechnologySignalOutput> {
	nitpicker_tech_detect::match_js_license_comment_signal(script).map(TechnologySignalOutput::from)
}
