//! htmlparser2 12.0.0's `Parser` in HTML mode: the open-element stack with
//! its implied closes, void elements, SVG name adjustments and the second-
//! `<form>` rule — recording, instead of calling a handler, the `onopentag` /
//! `onclosetag` events a handler would receive, each with the `startIndex` /
//! `endIndex` the handler would read from the parser at that moment.

// cspell:ignore fedropshadow

use std::ops::Range;

use crate::js_lower_case::to_lower_case_js;
use crate::tag_name::{TagName, TagNames};
use crate::tokenizer::{Callbacks, QuoteType, Tokenizer};

/// No event / no attributes.
pub const NONE: u32 = u32::MAX;

/// [`Event::tag_start`] of an event no opening tag was written for.
pub const NO_TAG: usize = usize::MAX;

/// What one recorded event is.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EventKind {
	/// `onopentag`.
	Open,
	/// `onclosetag`; `implied` when no closing tag of this element was read
	/// (an implied close, a void element, the end of the document).
	Close {
		/// htmlparser2's `isImplied`.
		implied: bool,
	},
}

/// One `onopentag` / `onclosetag` call.
#[derive(Clone, Copy, Debug)]
pub struct Event {
	/// Which callback.
	pub kind: EventKind,
	/// The element's name.
	pub name: TagName,
	/// `parser.startIndex` during the callback.
	pub start_index: usize,
	/// `parser.endIndex` during the callback.
	pub end_index: usize,
	/// For an [`EventKind::Open`] event read from an opening tag, the offset
	/// of that tag's `<` — which `start_index` is not after a closing tag
	/// whose rest htmlparser2 skipped (`</x ></y><z>` starts `z` at `x`'s
	/// last `>` + 1, inside `</y>`). [`NO_TAG`] for opens no tag was written
	/// for (`</p>`, `</br>`) and for every close.
	pub tag_start: usize,
	/// The tokenizer position whose character produced the event: the `>` of
	/// an opening tag, the end of a closing tag's name, the end of the opening
	/// tag's name for the closes that tag implied, the input length for the
	/// closes at the end of the document. Non-decreasing over the events.
	pub pos: usize,
	/// [`Document::attributes`] index of an [`EventKind::Open`] event's
	/// attributes, or [`NONE`] when it has none of the recorded ones.
	pub attributes: u32,
	/// For an [`EventKind::Open`] event whose element went onto the stack, the
	/// index of the [`EventKind::Close`] event that took it off; otherwise
	/// [`NONE`] (void elements, `</br>`).
	pub partner: u32,
}

/// The value of one recorded attribute: the raw source text (what
/// htmlparser2 reports with `decodeEntities: false`) and, when it held a
/// character reference, the decoded text (what it reports by default).
#[derive(Clone, Debug, Default)]
pub struct AttributeValue {
	/// Byte range of the raw value in the parsed input (empty for an attribute
	/// written without a value).
	pub raw: Range<usize>,
	/// The decoded value when it differs from the raw text.
	pub decoded: Option<Box<str>>,
}

impl AttributeValue {
	/// The value as written.
	#[must_use]
	pub fn raw<'a>(&self, html: &'a str) -> &'a str {
		&html[self.raw.clone()]
	}

	/// The value with character references decoded.
	#[must_use]
	pub fn decoded<'a>(&'a self, html: &'a str) -> &'a str {
		self.decoded.as_deref().unwrap_or_else(|| self.raw(html))
	}
}

/// The attributes the page-structure analyses read; every other attribute
/// is skipped without allocating. Like htmlparser2's `attribs`, the first
/// occurrence of a duplicated attribute wins.
#[derive(Clone, Debug, Default)]
pub struct Attributes {
	/// `class`.
	pub class: Option<AttributeValue>,
	/// `role`.
	pub role: Option<AttributeValue>,
	/// `type`.
	pub r#type: Option<AttributeValue>,
	/// `id`.
	pub id: Option<AttributeValue>,
}

/// A parsed document: its events in callback order.
#[derive(Debug)]
pub struct Document {
	/// Every `onopentag` / `onclosetag` call.
	pub events: Vec<Event>,
	/// Attribute sets referenced by [`Event::attributes`].
	pub attributes: Vec<Attributes>,
	names: TagNames,
}

impl Document {
	/// The text of an interned tag name.
	#[must_use]
	pub fn tag_name(&self, name: TagName) -> &str {
		self.names.name(name)
	}

	/// The attributes of an [`EventKind::Open`] event (empty when it has none).
	#[must_use]
	pub fn attributes_of(&self, event: &Event) -> &Attributes {
		static EMPTY: Attributes = Attributes {
			class: None,
			role: None,
			r#type: None,
			id: None,
		};
		if event.attributes == NONE {
			&EMPTY
		} else {
			&self.attributes[event.attributes as usize]
		}
	}
}

/// Parses `html` as htmlparser2 does with its default HTML-mode options.
#[must_use]
pub fn parse(html: &str) -> Document {
	let parser = Parser::new(html);
	let parser = Tokenizer::new(html.as_bytes(), parser).run();
	Document {
		events: parser.events,
		attributes: parser.attributes,
		names: parser.names,
	}
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum ForeignContext {
	None,
	Svg,
	MathMl,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum AttributeKind {
	Class,
	Role,
	Type,
	Id,
}

fn attribute_kind(name: &str) -> Option<AttributeKind> {
	// htmlparser2 lower-cases attribute names with `toLowerCase`; no
	// non-ASCII character lower-cases into any of these four ASCII names.
	if name.eq_ignore_ascii_case("class") {
		Some(AttributeKind::Class)
	} else if name.eq_ignore_ascii_case("role") {
		Some(AttributeKind::Role)
	} else if name.eq_ignore_ascii_case("type") {
		Some(AttributeKind::Type)
	} else if name.eq_ignore_ascii_case("id") {
		Some(AttributeKind::Id)
	} else {
		None
	}
}

const FORM_TAGS: &[TagName] = &[
	TagName::INPUT,
	TagName::OPTION,
	TagName::OPTGROUP,
	TagName::SELECT,
	TagName::BUTTON,
	TagName::DATALIST,
	TagName::TEXTAREA,
];
const P_TAG: &[TagName] = &[TagName::P];
const HEADING_TAGS: &[TagName] = &[
	TagName::H1,
	TagName::H2,
	TagName::H3,
	TagName::H4,
	TagName::H5,
	TagName::H6,
	TagName::P,
];
const TABLE_SECTION_TAGS: &[TagName] = &[TagName::THEAD, TagName::TBODY];
const DDT_TAGS: &[TagName] = &[TagName::DD, TagName::DT];
const RTP_TAGS: &[TagName] = &[TagName::RT, TagName::RP];

/// `openImpliesClose`.
fn open_implies_close(name: TagName) -> Option<&'static [TagName]> {
	Some(match name {
		TagName::TR => &[TagName::TR, TagName::TH, TagName::TD],
		TagName::TH => &[TagName::TH],
		TagName::TD => &[TagName::THEAD, TagName::TH, TagName::TD],
		TagName::BODY => &[TagName::HEAD, TagName::LINK, TagName::SCRIPT],
		TagName::A => &[TagName::A],
		TagName::LI => &[TagName::LI],
		TagName::H1 | TagName::H2 | TagName::H3 | TagName::H4 | TagName::H5 | TagName::H6 => {
			HEADING_TAGS
		}
		TagName::SELECT
		| TagName::INPUT
		| TagName::OUTPUT
		| TagName::BUTTON
		| TagName::DATALIST
		| TagName::TEXTAREA => FORM_TAGS,
		TagName::OPTION => &[TagName::OPTION],
		TagName::OPTGROUP => &[TagName::OPTGROUP, TagName::OPTION],
		TagName::DD | TagName::DT => DDT_TAGS,
		TagName::P
		| TagName::ADDRESS
		| TagName::ARTICLE
		| TagName::ASIDE
		| TagName::BLOCKQUOTE
		| TagName::DETAILS
		| TagName::DIV
		| TagName::DL
		| TagName::FIELDSET
		| TagName::FIGCAPTION
		| TagName::FIGURE
		| TagName::FOOTER
		| TagName::FORM
		| TagName::HEADER
		| TagName::HR
		| TagName::MAIN
		| TagName::NAV
		| TagName::OL
		| TagName::PRE
		| TagName::SECTION
		| TagName::TABLE
		| TagName::UL => P_TAG,
		TagName::RT | TagName::RP => RTP_TAGS,
		TagName::TBODY | TagName::TFOOT => TABLE_SECTION_TAGS,
		_ => return None,
	})
}

/// `voidElements` (HTML mode).
fn is_void_element(name: TagName) -> bool {
	matches!(
		name,
		TagName::AREA
			| TagName::BASE
			| TagName::BASEFONT
			| TagName::BR
			| TagName::COL
			| TagName::COMMAND
			| TagName::EMBED
			| TagName::FRAME
			| TagName::HR
			| TagName::IMG
			| TagName::INPUT
			| TagName::ISINDEX
			| TagName::KEYGEN
			| TagName::LINK
			| TagName::META
			| TagName::PARAM
			| TagName::SOURCE
			| TagName::TRACK
			| TagName::WBR
	)
}

/// `foreignContextElements`.
fn is_foreign_context_element(name: TagName) -> bool {
	name == TagName::MATH || name == TagName::SVG
}

/// `htmlIntegrationElements`.
fn is_html_integration_element(name: TagName) -> bool {
	matches!(
		name,
		TagName::MI
			| TagName::MO
			| TagName::MN
			| TagName::MS
			| TagName::MTEXT
			| TagName::ANNOTATION_XML
			| TagName::FOREIGN_OBJECT
			| TagName::DESC
			| TagName::TITLE
	)
}

/// `svgTagNameAdjustments`.
fn svg_tag_name_adjustment(name: &str) -> Option<&'static str> {
	Some(match name {
		"altglyph" => "altGlyph",
		"altglyphdef" => "altGlyphDef",
		"altglyphitem" => "altGlyphItem",
		"animatecolor" => "animateColor",
		"animatemotion" => "animateMotion",
		"animatetransform" => "animateTransform",
		"clippath" => "clipPath",
		"feblend" => "feBlend",
		"fecolormatrix" => "feColorMatrix",
		"fecomponenttransfer" => "feComponentTransfer",
		"fecomposite" => "feComposite",
		"feconvolvematrix" => "feConvolveMatrix",
		"fediffuselighting" => "feDiffuseLighting",
		"fedisplacementmap" => "feDisplacementMap",
		"fedistantlight" => "feDistantLight",
		"fedropshadow" => "feDropShadow",
		"feflood" => "feFlood",
		"fefunca" => "feFuncA",
		"fefuncb" => "feFuncB",
		"fefuncg" => "feFuncG",
		"fefuncr" => "feFuncR",
		"fegaussianblur" => "feGaussianBlur",
		"feimage" => "feImage",
		"femerge" => "feMerge",
		"femergenode" => "feMergeNode",
		"femorphology" => "feMorphology",
		"feoffset" => "feOffset",
		"fepointlight" => "fePointLight",
		"fespecularlighting" => "feSpecularLighting",
		"fespotlight" => "feSpotLight",
		"fetile" => "feTile",
		"feturbulence" => "feTurbulence",
		"foreignobject" => "foreignObject",
		"glyphref" => "glyphRef",
		"lineargradient" => "linearGradient",
		"radialgradient" => "radialGradient",
		"textpath" => "textPath",
		_ => return None,
	})
}

#[derive(Clone, Copy, Debug)]
struct StackEntry {
	name: TagName,
	open_event: u32,
}

/// An attribute value being read.
#[derive(Debug, Default)]
struct PendingValue {
	kind: Option<AttributeKind>,
	decoded: String,
	has_entity: bool,
	high_surrogate: Option<u32>,
	raw_start: usize,
	raw_end: usize,
}

struct Parser<'a> {
	buffer: &'a str,
	start_index: usize,
	end_index: usize,
	open_tag_start: usize,
	/// The `<` of the opening tag being read (`NO_TAG` for implied opens).
	open_tag_lt: usize,
	tagname: Option<TagName>,
	value: PendingValue,
	attribs: Option<Attributes>,
	stack: Vec<StackEntry>,
	foreign_context: Vec<ForeignContext>,
	events: Vec<Event>,
	attributes: Vec<Attributes>,
	names: TagNames,
}

impl<'a> Parser<'a> {
	fn new(buffer: &'a str) -> Self {
		Self {
			buffer,
			start_index: 0,
			end_index: 0,
			open_tag_start: 0,
			open_tag_lt: NO_TAG,
			tagname: None,
			value: PendingValue::default(),
			attribs: None,
			stack: Vec::new(),
			foreign_context: vec![ForeignContext::None],
			events: Vec::new(),
			attributes: Vec::new(),
			names: TagNames::default(),
		}
	}

	fn record(&mut self, kind: EventKind, name: TagName, pos: usize, attributes: u32) -> u32 {
		let index = u32::try_from(self.events.len()).expect("fewer than 2^32 events");
		self.events.push(Event {
			kind,
			name,
			start_index: self.start_index,
			end_index: self.end_index,
			tag_start: if kind == EventKind::Open {
				self.open_tag_lt
			} else {
				NO_TAG
			},
			pos,
			attributes,
			partner: NONE,
		});
		index
	}

	fn read_tag_name(&mut self, start: usize, end_index: usize) -> TagName {
		let buffer = self.buffer;
		let name = to_lower_case_js(&buffer[start..end_index]);

		if self.foreign_context.last() == Some(&ForeignContext::Svg) {
			return self
				.names
				.intern(svg_tag_name_adjustment(&name).unwrap_or(&name));
		}

		if self.foreign_context.len() > 1
			&& let Some(adjusted) = svg_tag_name_adjustment(&name)
		{
			let adjusted = self.names.intern(adjusted);
			if self.stack.iter().any(|entry| entry.name == adjusted) {
				return adjusted;
			}
		}

		if !self.is_in_foreign_context() && name == "image" {
			return TagName::IMG;
		}

		self.names.intern(&name)
	}

	fn emit_open_tag(&mut self, name: TagName, pos: usize) {
		self.open_tag_start = self.start_index;
		self.tagname = Some(name);

		if name == TagName::FORM && self.stack.iter().any(|entry| entry.name == TagName::FORM) {
			self.tagname = None;
			return;
		}

		if let Some(implies_close) = open_implies_close(name) {
			while let Some(top) = self.stack.last()
				&& implies_close.contains(&top.name)
			{
				self.pop_element(true, pos);
			}
		}
		if !is_void_element(name) {
			self.stack.push(StackEntry {
				name,
				open_event: NONE,
			});
			if name == TagName::SVG {
				self.foreign_context.push(ForeignContext::Svg);
			} else if name == TagName::MATH {
				self.foreign_context.push(ForeignContext::MathMl);
			} else if is_html_integration_element(name) {
				self.foreign_context.push(ForeignContext::None);
			}
		}
		self.attribs = Some(Attributes::default());
	}

	fn end_open_tag(&mut self, pos: usize) {
		self.start_index = self.open_tag_start;

		if let Some(attributes) = self.attribs.take()
			&& let Some(name) = self.tagname
		{
			let attributes_index = if attributes.class.is_none()
				&& attributes.role.is_none()
				&& attributes.r#type.is_none()
				&& attributes.id.is_none()
			{
				NONE
			} else {
				self.attributes.push(attributes);
				u32::try_from(self.attributes.len() - 1).expect("fewer than 2^32 attribute sets")
			};
			let event = self.record(EventKind::Open, name, pos, attributes_index);
			if !is_void_element(name)
				&& let Some(top) = self.stack.last_mut()
				&& top.name == name
			{
				top.open_event = event;
			}
		}
		if let Some(name) = self.tagname
			&& is_void_element(name)
		{
			self.record(EventKind::Close { implied: true }, name, pos, NONE);
		}

		self.tagname = None;
	}

	fn pop_element(&mut self, implied: bool, pos: usize) {
		let entry = self
			.stack
			.pop()
			.expect("pop_element is only called on a non-empty stack");
		if is_foreign_context_element(entry.name) || is_html_integration_element(entry.name) {
			self.foreign_context.pop();
		}
		let close = self.record(EventKind::Close { implied }, entry.name, pos, NONE);
		if entry.open_event != NONE {
			self.events[entry.open_event as usize].partner = close;
		}
	}

	fn close_current_tag(&mut self, is_open_implied: bool, pos: usize) {
		let name = self.tagname;
		self.end_open_tag(pos);
		if let Some(name) = name
			&& self.stack.last().is_some_and(|top| top.name == name)
		{
			self.pop_element(!is_open_implied, pos);
		}
	}

	fn push_decoded_code_point(&mut self, code_point: u32) {
		let value = &mut self.value;
		if let Some(high) = value.high_surrogate.take() {
			if (0xDC00..=0xDFFF).contains(&code_point) {
				let combined = 0x1_0000 + ((high - 0xD800) << 10) + (code_point - 0xDC00);
				value
					.decoded
					.push(char::from_u32(combined).unwrap_or('\u{FFFD}'));
				return;
			}
			value.decoded.push('\u{FFFD}');
		}
		if (0xD800..=0xDBFF).contains(&code_point) {
			value.high_surrogate = Some(code_point);
		} else {
			value
				.decoded
				.push(char::from_u32(code_point).unwrap_or('\u{FFFD}'));
		}
	}
}

impl Callbacks for Parser<'_> {
	fn on_attrib_data(&mut self, start: usize, end_index: usize) {
		if self.value.kind.is_some() {
			// A high surrogate not followed by its pair stays lone in the JS
			// string; it reaches every byte-level consumer as U+FFFD.
			if self.value.high_surrogate.take().is_some() {
				self.value.decoded.push('\u{FFFD}');
			}
			self.value.decoded.push_str(&self.buffer[start..end_index]);
			self.value.raw_end = end_index;
		}
	}

	fn on_attrib_entity(&mut self, code_point: u32) {
		if self.value.kind.is_some() {
			self.value.has_entity = true;
			self.push_decoded_code_point(code_point);
		}
	}

	fn on_attrib_end(&mut self, quote: QuoteType, end_index: usize) {
		self.end_index = end_index;
		let value = std::mem::take(&mut self.value);
		let (Some(kind), Some(attributes)) = (value.kind, self.attribs.as_mut()) else {
			return;
		};
		let slot = match kind {
			AttributeKind::Class => &mut attributes.class,
			AttributeKind::Role => &mut attributes.role,
			AttributeKind::Type => &mut attributes.r#type,
			AttributeKind::Id => &mut attributes.id,
		};
		if slot.is_some() {
			return;
		}
		let raw = if quote == QuoteType::NoValue {
			value.raw_start..value.raw_start
		} else {
			value.raw_start..value.raw_end
		};
		let mut decoded = value.decoded;
		if value.high_surrogate.is_some() {
			decoded.push('\u{FFFD}');
		}
		*slot = Some(AttributeValue {
			raw,
			decoded: value.has_entity.then(|| decoded.into_boxed_str()),
		});
	}

	fn on_attrib_name(&mut self, start: usize, end_index: usize) {
		self.start_index = start;
		self.value = PendingValue {
			kind: attribute_kind(&self.buffer[start..end_index]),
			raw_start: end_index,
			raw_end: end_index,
			..PendingValue::default()
		};
	}

	fn on_attrib_value_start(&mut self, start: usize) {
		self.value.raw_start = start;
		self.value.raw_end = start;
	}

	fn on_cdata(&mut self, _start: usize, end_index: usize, _end_offset: usize) {
		self.end_index = end_index;
		self.start_index = end_index + 1;
	}

	fn on_close_tag(&mut self, start: usize, end_index: usize) {
		self.end_index = end_index;
		let name = self.read_tag_name(start, end_index);

		if !is_void_element(name) {
			if let Some(from_top) = self.stack.iter().rev().position(|entry| entry.name == name) {
				for _ in 0..from_top {
					self.pop_element(true, end_index);
				}
				self.pop_element(false, end_index);
			} else if name == TagName::P {
				self.open_tag_lt = NO_TAG;
				self.emit_open_tag(TagName::P, end_index);
				self.close_current_tag(true, end_index);
			}
		} else if name == TagName::BR {
			self.open_tag_lt = NO_TAG;
			self.record(EventKind::Open, TagName::BR, end_index, NONE);
			self.record(
				EventKind::Close { implied: false },
				TagName::BR,
				end_index,
				NONE,
			);
		}

		self.start_index = end_index + 1;
	}

	fn on_comment(&mut self, _start: usize, end_index: usize, _end_offset: usize) {
		self.end_index = end_index;
		self.start_index = end_index + 1;
	}

	fn on_declaration(&mut self, _start: usize, end_index: usize) {
		self.end_index = end_index;
		self.start_index = end_index + 1;
	}

	fn on_end(&mut self) {
		let pos = self.buffer.len();
		self.end_index = self.start_index;
		// htmlparser2 reports these closes without popping its stack.
		for depth in (0..self.stack.len()).rev() {
			let entry = self.stack[depth];
			let close = self.record(EventKind::Close { implied: true }, entry.name, pos, NONE);
			if entry.open_event != NONE {
				self.events[entry.open_event as usize].partner = close;
			}
		}
	}

	fn on_open_tag_end(&mut self, end_index: usize) {
		self.end_index = end_index;
		self.end_open_tag(end_index);
		self.start_index = end_index + 1;
	}

	fn on_open_tag_name(&mut self, start: usize, end_index: usize) {
		self.end_index = end_index;
		// The tokenizer starts a tag name right after its `<`.
		self.open_tag_lt = start - 1;
		let name = self.read_tag_name(start, end_index);
		self.emit_open_tag(name, end_index);
	}

	fn on_self_closing_tag(&mut self, end_index: usize) {
		self.end_index = end_index;
		if self.is_in_foreign_context() {
			self.close_current_tag(false, end_index);
			self.start_index = end_index + 1;
		} else {
			self.on_open_tag_end(end_index);
		}
	}

	fn on_text(&mut self, _start: usize, end_index: usize) {
		self.end_index = end_index.saturating_sub(1);
		self.start_index = end_index;
	}

	fn on_text_entity(&mut self, _code_point: u32, end_index: usize) {
		self.end_index = end_index.saturating_sub(1);
		self.start_index = end_index;
	}

	fn is_in_foreign_context(&self) -> bool {
		self.foreign_context.last() != Some(&ForeignContext::None)
	}
}
