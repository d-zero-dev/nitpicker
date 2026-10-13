//! Event sequences recorded from htmlparser2 12.0.0 (a handler logging
//! `onopentag` / `onclosetag` with `parser.startIndex` / `parser.endIndex`),
//! pinned so a change to the port shows up as a diff against them.

// cspell:ignore ampx

use nitpicker_html_parser::{Document, EventKind, parse};

/// One event as `(kind, name, startIndex, endIndex)`, kind being `"open"`,
/// `"close"` (explicit) or `"implied"` (htmlparser2's `isImplied`).
type Row = (&'static str, String, usize, usize);

fn rows(document: &Document) -> Vec<Row> {
	document
		.events
		.iter()
		.map(|event| {
			let kind = match event.kind {
				EventKind::Open => "open",
				EventKind::Close { implied: false } => "close",
				EventKind::Close { implied: true } => "implied",
			};
			(
				kind,
				document.tag_name(event.name).to_owned(),
				event.start_index,
				event.end_index,
			)
		})
		.collect()
}

fn row(kind: &'static str, name: &str, start: usize, end: usize) -> Row {
	(kind, name.to_owned(), start, end)
}

#[test]
fn closes_a_paragraph_implied_by_a_block_and_reports_its_indices() {
	let document = parse("<body><p>a<div>b</div></body>");
	assert_eq!(
		rows(&document),
		vec![
			row("open", "body", 0, 5),
			row("open", "p", 6, 8),
			row("implied", "p", 10, 14),
			row("open", "div", 10, 14),
			row("close", "div", 16, 21),
			row("close", "body", 22, 28),
		]
	);
}

#[test]
fn starts_a_tag_after_a_spaced_closing_tag_at_that_tags_greater_than_sign() {
	let document = parse("<div></div ><p>x</p>");
	assert_eq!(
		rows(&document),
		vec![
			row("open", "div", 0, 4),
			row("close", "div", 5, 10),
			row("open", "p", 11, 14),
			row("close", "p", 16, 19),
		]
	);
}

#[test]
fn opens_an_implied_paragraph_and_line_break_for_their_stray_closing_tags() {
	let document = parse("</p><br></br>");
	assert_eq!(
		rows(&document),
		vec![
			row("open", "p", 0, 3),
			row("close", "p", 0, 3),
			row("open", "br", 4, 7),
			row("implied", "br", 4, 7),
			row("open", "br", 8, 12),
			row("close", "br", 8, 12),
		]
	);
}

#[test]
fn ignores_a_form_opened_inside_a_form() {
	let document = parse("<form><form class=a></form></form>");
	assert_eq!(
		rows(&document),
		vec![row("open", "form", 0, 5), row("close", "form", 20, 26)]
	);
}

#[test]
fn self_closes_and_adjusts_names_inside_svg() {
	let document = parse("<svg><path/><foreignobject><div/></foreignObject></svg>");
	assert_eq!(
		rows(&document),
		vec![
			row("open", "svg", 0, 4),
			row("open", "path", 5, 11),
			row("implied", "path", 5, 11),
			row("open", "foreignObject", 12, 26),
			row("open", "div", 27, 32),
			row("implied", "div", 33, 48),
			row("close", "foreignObject", 33, 48),
			row("close", "svg", 49, 54),
		]
	);
}

#[test]
fn decodes_attribute_values_and_keeps_their_raw_text() {
	let html = "<div class='a&amp;b &ampx' role=nav ID=main>";
	let document = parse(html);
	assert_eq!(
		rows(&document),
		vec![row("open", "div", 0, 43), row("implied", "div", 44, 44)]
	);
	let attributes = document.attributes_of(&document.events[0]);
	let class = attributes.class.as_ref().unwrap();
	assert_eq!(class.decoded(html), "a&b &ampx");
	assert_eq!(class.raw(html), "a&amp;b &ampx");
	assert_eq!(attributes.role.as_ref().unwrap().decoded(html), "nav");
	assert_eq!(attributes.id.as_ref().unwrap().decoded(html), "main");
	assert!(attributes.r#type.is_none());
}

#[test]
fn closes_list_items_implied_by_the_next_item() {
	let document = parse("<ul><li>a<li>b</ul>");
	assert_eq!(
		rows(&document),
		vec![
			row("open", "ul", 0, 3),
			row("open", "li", 4, 7),
			row("implied", "li", 9, 12),
			row("open", "li", 9, 12),
			row("implied", "li", 14, 18),
			row("close", "ul", 14, 18),
		]
	);
}

#[test]
fn reads_script_content_as_raw_text() {
	let document = parse("<script>a</b></script><x>");
	assert_eq!(
		rows(&document),
		vec![
			row("open", "script", 0, 7),
			row("close", "script", 13, 21),
			row("open", "x", 22, 24),
			row("implied", "x", 25, 25),
		]
	);
}

#[test]
fn moves_the_start_index_to_the_end_for_a_document_cut_inside_a_tag() {
	// The tag never ends, so only its close at the end of the document fires.
	let document = parse("<div /");
	assert_eq!(rows(&document), vec![row("implied", "div", 6, 6)]);
}

#[test]
fn reads_image_as_img() {
	let document = parse("<IMAGE>");
	assert_eq!(
		rows(&document),
		vec![row("open", "img", 0, 6), row("implied", "img", 0, 6)]
	);
}

#[test]
fn does_not_end_a_title_at_an_escaped_closing_tag() {
	let document = parse("<title>&lt;/title></title>");
	assert_eq!(
		rows(&document),
		vec![row("open", "title", 0, 6), row("close", "title", 18, 25)]
	);
}

#[test]
fn records_where_each_opening_tag_was_written() {
	// `<a>`'s start index is 16 (inside the skipped `</b>`), its tag is at 20;
	// the `</p>` open was never written.
	let document = parse("<body><b><i></i </b><a>x</a></p></b></body>");
	let starts: Vec<(String, usize, usize)> = document
		.events
		.iter()
		.filter(|event| event.kind == EventKind::Open)
		.map(|event| {
			(
				document.tag_name(event.name).to_owned(),
				event.start_index,
				event.tag_start,
			)
		})
		.collect();
	assert_eq!(
		starts,
		vec![
			("body".to_owned(), 0, 0),
			("b".to_owned(), 6, 6),
			("i".to_owned(), 9, 9),
			("a".to_owned(), 16, 20),
			("p".to_owned(), 28, nitpicker_html_parser::NO_TAG),
		]
	);
}

#[test]
fn links_each_pushed_element_to_the_close_that_popped_it() {
	let document = parse("<ul><li>a<li>b</ul><br>");
	let partners: Vec<u32> = document.events.iter().map(|event| event.partner).collect();
	// ul → its close (5), first li → its implied close (2), second li → 4,
	// br is void and never pushed.
	assert_eq!(
		partners,
		vec![
			5,
			2,
			nitpicker_html_parser::NONE,
			4,
			nitpicker_html_parser::NONE,
			nitpicker_html_parser::NONE,
			nitpicker_html_parser::NONE,
			nitpicker_html_parser::NONE,
		]
	);
}
