//! Exposes the intermediate results of one page for the parity tests
//! against the JavaScript implementation.

use std::fmt::Write as _;

use nitpicker_html_parser::{AttributeValue, EventKind, parse};

use crate::collect_deep_spans::collect_deep_spans;
use crate::content_root::{ContentRoot, find_content_root};
use crate::detect_content_depth_cap::CANDIDATE_DEPTHS;
use crate::excise::excise;
use crate::extract_landmarks::extract_landmarks;
use crate::js_string::json_string;
use crate::page::{Preparation, prepare_page};
use crate::tokenize::{Tokenized, tokenize};
use crate::vocabulary::{Ids, Vocabulary};

fn json_list<'a>(items: impl Iterator<Item = &'a str>) -> String {
	let quoted: Vec<String> = items.map(json_string).collect();
	format!("[{}]", quoted.join(","))
}

fn token_list(tokenized: &Tokenized, vocabulary: &Vocabulary) -> String {
	let texts: Vec<String> = tokenized
		.tokens
		.iter()
		.map(|&id| vocabulary.token(id).to_string())
		.collect();
	json_list(texts.iter().map(String::as_str))
}

fn attribute(html: &str, value: Option<&AttributeValue>, decoded: bool) -> String {
	match value {
		Some(value) if decoded => json_string(value.decoded(html)),
		Some(value) => json_string(value.raw(html)),
		None => "null".to_owned(),
	}
}

/// A JSON record of what the classifier derives from `html`, byte offsets
/// included.
#[must_use]
pub fn parity_probe(html: &str, hint: Option<&ContentRoot>) -> String {
	let vocabulary = Vocabulary::default();
	let mut ids = Ids::Shared(&vocabulary);
	let document = parse(html);

	let mut events = String::from("[");
	for (index, event) in document.events.iter().enumerate() {
		let kind = match event.kind {
			EventKind::Open => "open",
			EventKind::Close { implied: false } => "close",
			EventKind::Close { implied: true } => "implied",
		};
		let attributes = document.attributes_of(event);
		if index > 0 {
			events.push(',');
		}
		let _ = write!(
			events,
			"[\"{kind}\",{},{},{},[{},{},{},{},{}]]",
			json_string(document.tag_name(event.name)),
			event.start_index,
			event.end_index,
			attribute(html, attributes.class.as_ref(), true),
			attribute(html, attributes.class.as_ref(), false),
			attribute(html, attributes.role.as_ref(), true),
			attribute(html, attributes.r#type.as_ref(), true),
			attribute(html, attributes.id.as_ref(), false),
		);
	}
	events.push(']');

	let tokenized = tokenize(html, None, &mut ids);
	let classes: Vec<String> = tokenized
		.classes
		.iter()
		.map(|&id| vocabulary.classes.resolve(id).to_string())
		.collect();

	let landmarks = extract_landmarks(html, &document);
	let instances: Vec<String> = landmarks
		.instances
		.iter()
		.map(|(kind, range)| format!("[\"{}\",{},{}]", kind.name(), range.start, range.end))
		.collect();

	let prepared = &landmarks.remainder;
	let prepared_document = parse(prepared);
	let content = find_content_root(prepared, &prepared_document, hint);
	let content_json = content.as_ref().map_or_else(
		|| "null".to_owned(),
		|range| format!("[{},{}]", range.start, range.end),
	);

	let page = prepare_page(
		html,
		hint,
		Preparation {
			sweep: true,
			retain_markup: false,
		},
		&mut ids,
	);
	let replayed: Vec<String> = (0..CANDIDATE_DEPTHS.len())
		.map(|index| token_list(page.depth_tokens.at(Some(index)), &vocabulary))
		.collect();
	let reparsed: Vec<String> = match &content {
		Some(content) => collect_deep_spans(prepared, content.clone(), &CANDIDATE_DEPTHS)
			.iter()
			.map(|spans| {
				token_list(
					&tokenize(&excise(prepared, spans), None, &mut ids),
					&vocabulary,
				)
			})
			.collect(),
		None => vec![
			token_list(&tokenize(prepared, None, &mut ids), &vocabulary);
			CANDIDATE_DEPTHS.len()
		],
	};
	let instance_tokens: Vec<String> = page
		.instances
		.iter()
		.map(|instance| {
			let texts: Vec<String> = instance
				.tokens
				.iter()
				.map(|&id| vocabulary.token(id).to_string())
				.collect();
			format!(
				"[\"{}\",{}]",
				instance.kind.name(),
				json_list(texts.iter().map(String::as_str))
			)
		})
		.collect();

	format!(
		"{{\"events\":{events},\"tokens\":{},\"classes\":{},\"landmarks\":[{}],\"remainder\":{},\"content\":{content_json},\"depthTokens\":[{}],\"depthTokensReparsed\":[{}],\"instances\":[{}]}}",
		token_list(&tokenized, &vocabulary),
		json_list(classes.iter().map(String::as_str)),
		instances.join(","),
		json_string(prepared),
		replayed.join(","),
		reparsed.join(","),
		instance_tokens.join(","),
	)
}
