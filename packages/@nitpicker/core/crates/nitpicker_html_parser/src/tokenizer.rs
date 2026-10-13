//! htmlparser2 12.0.0's `Tokenizer` in HTML mode (`xmlMode: false`,
//! `decodeEntities: true`, `recognizeSelfClosing: false`), ported state by
//! state.
//!
//! It runs over UTF-8 bytes where htmlparser2 runs over UTF-16 code units.
//! Every decision the tokenizer makes compares a unit against an ASCII
//! character, and a non-ASCII character is "none of them" whether it arrives
//! as one UTF-16 unit or as two to four UTF-8 bytes — each repeated "none of
//! them" step leaves the state where the first one did. So the two produce
//! the same callbacks at the same character positions, and every index here
//! is the byte offset of the character htmlparser2 reports the UTF-16 offset
//! of. Callers slice the same bytes they parsed, so the unit never leaks.

use crate::entity_decoder::{DecodingMode, Emitted, EntityDecoder, WriteResult};

const TAB: u8 = 0x09;
const NEW_LINE: u8 = 0x0A;
const FORM_FEED: u8 = 0x0C;
const CARRIAGE_RETURN: u8 = 0x0D;
const SPACE: u8 = 0x20;
const EXCLAMATION_MARK: u8 = b'!';
const AMP: u8 = b'&';
const SINGLE_QUOTE: u8 = b'\'';
const DOUBLE_QUOTE: u8 = b'"';
const DASH: u8 = b'-';
const SLASH: u8 = b'/';
const LT: u8 = b'<';
const EQ: u8 = b'=';
const GT: u8 = b'>';
const QUESTION_MARK: u8 = b'?';
const OPENING_SQUARE_BRACKET: u8 = b'[';

/// htmlparser2's `sectionStart = -1`: no section is being read.
pub(crate) const NO_SECTION: usize = usize::MAX;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum State {
	Text,
	BeforeTagName,
	InTagName,
	InSelfClosingTag,
	BeforeClosingTagName,
	InClosingTagName,
	AfterClosingTagName,
	BeforeAttributeName,
	InAttributeName,
	AfterAttributeName,
	BeforeAttributeValue,
	InAttributeValueDq,
	InAttributeValueSq,
	InAttributeValueNq,
	BeforeDeclaration,
	InDeclaration,
	BeforeComment,
	CdataSequence,
	DeclarationSequence,
	InSpecialComment,
	InCommentLike,
	SpecialStartSequence,
	InSpecialTag,
	InPlainText,
	InEntity,
}

/// htmlparser2's `Sequences`, compared by identity there and by variant here.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Sequence {
	Empty,
	Cdata,
	CdataEnd,
	CommentEnd,
	Doctype,
	IframeEnd,
	NoembedEnd,
	NoframesEnd,
	Plaintext,
	ScriptEnd,
	StyleEnd,
	TitleEnd,
	TextareaEnd,
	XmpEnd,
}

impl Sequence {
	fn bytes(self) -> &'static [u8] {
		match self {
			Self::Empty => b"",
			Self::Cdata => b"CDATA[",
			Self::CdataEnd => b"]]>",
			Self::CommentEnd => b"--!>",
			Self::Doctype => b"doctype",
			Self::IframeEnd => b"</iframe",
			Self::NoembedEnd => b"</noembed",
			Self::NoframesEnd => b"</noframes",
			Self::Plaintext => b"</plaintext",
			Self::ScriptEnd => b"</script",
			Self::StyleEnd => b"</style",
			Self::TitleEnd => b"</title",
			Self::TextareaEnd => b"</textarea",
			Self::XmpEnd => b"</xmp",
		}
	}

	/// `specialStartSequences`: keyed by the lower-cased first tag-name byte.
	fn special_start(first_lower: u8) -> Option<Self> {
		match first_lower {
			b'i' => Some(Self::IframeEnd),
			b'n' => Some(Self::NoembedEnd),
			b'p' => Some(Self::Plaintext),
			b's' => Some(Self::ScriptEnd),
			b't' => Some(Self::TitleEnd),
			b'x' => Some(Self::XmpEnd),
			_ => None,
		}
	}

	fn len(self) -> usize {
		self.bytes().len()
	}

	/// The byte at `index`, or `None` past the end (JS reads `undefined`,
	/// which equals no character).
	fn at(self, index: usize) -> Option<u8> {
		self.bytes().get(index).copied()
	}
}

/// How an attribute value was written.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum QuoteType {
	NoValue,
	Unquoted,
	Single,
	Double,
}

/// The parser side of the tokenizer, mirroring htmlparser2's `Callbacks`
/// (the subset HTML mode reaches). `on_attrib_value_start` is an addition:
/// it tells the parser where an attribute value's raw text begins, which
/// htmlparser2 never reports because it only keeps the decoded value.
pub(crate) trait Callbacks {
	fn on_attrib_data(&mut self, start: usize, end_index: usize);
	fn on_attrib_entity(&mut self, code_point: u32);
	fn on_attrib_end(&mut self, quote: QuoteType, end_index: usize);
	fn on_attrib_name(&mut self, start: usize, end_index: usize);
	fn on_attrib_value_start(&mut self, start: usize);
	fn on_cdata(&mut self, start: usize, end_index: usize, end_offset: usize);
	fn on_close_tag(&mut self, start: usize, end_index: usize);
	fn on_comment(&mut self, start: usize, end_index: usize, end_offset: usize);
	fn on_declaration(&mut self, start: usize, end_index: usize);
	fn on_end(&mut self);
	fn on_open_tag_end(&mut self, end_index: usize);
	fn on_open_tag_name(&mut self, start: usize, end_index: usize);
	fn on_self_closing_tag(&mut self, end_index: usize);
	fn on_text(&mut self, start: usize, end_index: usize);
	fn on_text_entity(&mut self, code_point: u32, end_index: usize);
	fn is_in_foreign_context(&self) -> bool;
}

fn is_whitespace(c: u8) -> bool {
	matches!(c, SPACE | NEW_LINE | TAB | FORM_FEED | CARRIAGE_RETURN)
}

fn is_end_of_tag_section(c: u8) -> bool {
	c == SLASH || c == GT || is_whitespace(c)
}

fn is_ascii_alpha(c: u8) -> bool {
	c.is_ascii_alphabetic()
}

/// Tokenizes `buffer` in one `write` + `end`, the way `Parser::end(html)`
/// drives htmlparser2's tokenizer.
pub(crate) struct Tokenizer<'a, C: Callbacks> {
	state: State,
	buffer: &'a [u8],
	section_start: usize,
	index: usize,
	entity_start: usize,
	base_state: State,
	is_special: bool,
	current_sequence: Sequence,
	sequence_index: usize,
	entity_decoder: EntityDecoder,
	cbs: C,
}

impl<'a, C: Callbacks> Tokenizer<'a, C> {
	pub(crate) fn new(buffer: &'a [u8], cbs: C) -> Self {
		Self {
			state: State::Text,
			buffer,
			section_start: 0,
			index: 0,
			entity_start: 0,
			base_state: State::Text,
			is_special: false,
			current_sequence: Sequence::Empty,
			sequence_index: 0,
			entity_decoder: EntityDecoder::default(),
			cbs,
		}
	}

	/// Runs the whole buffer through and returns the callbacks.
	pub(crate) fn run(mut self) -> C {
		self.parse();
		self.finish();
		self.cbs
	}

	fn len(&self) -> usize {
		self.buffer.len()
	}

	fn state_text(&mut self, c: u8) {
		if c == LT {
			if self.index > self.section_start {
				self.cbs.on_text(self.section_start, self.index);
			}
			self.state = State::BeforeTagName;
			self.section_start = self.index;
		} else if c == AMP {
			self.start_entity();
		}
	}

	fn enter_tag_body(&mut self) {
		if self.current_sequence == Sequence::Plaintext {
			self.current_sequence = Sequence::Empty;
			self.state = State::InPlainText;
		} else if self.is_special {
			self.state = State::InSpecialTag;
			self.sequence_index = 0;
		} else {
			self.state = State::Text;
		}
	}

	fn state_special_start_sequence(&mut self, c: u8) {
		let lower = c | 0x20;

		if self.sequence_index < self.current_sequence.len() {
			if Some(lower) == self.current_sequence.at(self.sequence_index) {
				self.sequence_index += 1;
				return;
			}

			if self.sequence_index == 3 {
				if self.current_sequence == Sequence::ScriptEnd
					&& Some(lower) == Sequence::StyleEnd.at(3)
				{
					self.current_sequence = Sequence::StyleEnd;
					self.sequence_index = 4;
					return;
				}
				if self.current_sequence == Sequence::TitleEnd
					&& Some(lower) == Sequence::TextareaEnd.at(3)
				{
					self.current_sequence = Sequence::TextareaEnd;
					self.sequence_index = 4;
					return;
				}
			} else if self.sequence_index == 4
				&& self.current_sequence == Sequence::NoembedEnd
				&& Some(lower) == Sequence::NoframesEnd.at(4)
			{
				self.current_sequence = Sequence::NoframesEnd;
				self.sequence_index = 5;
				return;
			}
		} else if is_end_of_tag_section(c) {
			self.sequence_index = 0;
			self.state = State::InTagName;
			self.state_in_tag_name(c);
			return;
		}

		self.is_special = false;
		self.current_sequence = Sequence::Empty;
		self.sequence_index = 0;
		self.state = State::InTagName;
		self.state_in_tag_name(c);
	}

	fn state_cdata_sequence(&mut self, c: u8) {
		if Some(c) == Sequence::Cdata.at(self.sequence_index) {
			self.sequence_index += 1;
			if self.sequence_index == Sequence::Cdata.len() {
				self.state = State::InCommentLike;
				self.current_sequence = Sequence::CdataEnd;
				self.sequence_index = 0;
				self.section_start = self.index + 1;
			}
		} else {
			self.sequence_index = 0;
			self.state = State::InSpecialComment;
			self.state_in_special_comment(c);
		}
	}

	/// `fastForwardTo`: skips ahead to the next `c`, leaving `index` on it.
	fn fast_forward_to(&mut self, c: u8) -> bool {
		let from = self.index + 1;
		if let Some(found) = self.buffer.get(from..).and_then(|rest| memchr(c, rest)) {
			self.index = from + found;
			return true;
		}
		self.index = self.len() - 1;
		false
	}

	fn emit_comment(&mut self, offset: usize) {
		self.cbs.on_comment(self.section_start, self.index, offset);
		self.sequence_index = 0;
		self.section_start = self.index + 1;
		self.state = State::Text;
	}

	fn state_in_comment_like(&mut self, c: u8) {
		if self.current_sequence == Sequence::CommentEnd
			&& self.sequence_index <= 1
			&& self.index == self.section_start + self.sequence_index
			&& c == GT
		{
			self.emit_comment(self.sequence_index);
		} else if self.current_sequence == Sequence::CommentEnd
			&& self.sequence_index == 2
			&& c == GT
		{
			self.emit_comment(2);
		} else if self.current_sequence == Sequence::CommentEnd
			&& self.sequence_index == self.current_sequence.len() - 1
			&& c != GT
		{
			self.sequence_index = usize::from(c == DASH);
		} else if Some(c) == self.current_sequence.at(self.sequence_index) {
			self.sequence_index += 1;
			if self.sequence_index == self.current_sequence.len() {
				if self.current_sequence == Sequence::CdataEnd {
					self.cbs.on_cdata(self.section_start, self.index, 2);
				} else {
					self.cbs.on_comment(self.section_start, self.index, 3);
				}
				self.sequence_index = 0;
				self.section_start = self.index + 1;
				self.state = State::Text;
			}
		} else if self.sequence_index == 0 {
			let first = self.current_sequence.at(0).unwrap_or_default();
			if self.fast_forward_to(first) {
				self.sequence_index = 1;
			}
		} else if Some(c) != self.current_sequence.at(self.sequence_index - 1) {
			self.sequence_index = 0;
		}
	}

	fn state_in_special_tag(&mut self, c: u8) {
		if self.sequence_index == self.current_sequence.len() {
			if is_end_of_tag_section(c) {
				let end_of_text = self.index - self.current_sequence.len();
				if self.section_start < end_of_text {
					self.cbs.on_text(self.section_start, end_of_text);
				}
				self.is_special = false;
				self.section_start = end_of_text + 2;
				self.state_in_closing_tag_name(c);
				return;
			}
			self.sequence_index = 0;
		}

		if Some(c | 0x20) == self.current_sequence.at(self.sequence_index) {
			self.sequence_index += 1;
		} else if self.sequence_index == 0 {
			if self.current_sequence == Sequence::TitleEnd
				|| self.current_sequence == Sequence::TextareaEnd
			{
				if c == AMP {
					self.start_entity();
				}
			} else if self.fast_forward_to(LT) {
				self.sequence_index = 1;
			}
		} else {
			self.sequence_index = usize::from(c == LT);
		}
	}

	fn state_before_tag_name(&mut self, c: u8) {
		if c == EXCLAMATION_MARK {
			self.state = State::BeforeDeclaration;
			self.section_start = self.index + 1;
		} else if c == QUESTION_MARK {
			self.state = State::InSpecialComment;
			self.section_start = self.index;
		} else if is_ascii_alpha(c) {
			self.section_start = self.index;
			let special = if self.cbs.is_in_foreign_context() {
				None
			} else {
				Sequence::special_start(c | 0x20)
			};
			if let Some(special) = special {
				self.is_special = true;
				self.current_sequence = special;
				self.sequence_index = 3;
				self.state = State::SpecialStartSequence;
			} else {
				self.state = State::InTagName;
			}
		} else if c == SLASH {
			self.state = State::BeforeClosingTagName;
		} else {
			self.state = State::Text;
			self.state_text(c);
		}
	}

	fn state_in_tag_name(&mut self, c: u8) {
		if is_end_of_tag_section(c) {
			self.cbs.on_open_tag_name(self.section_start, self.index);
			self.section_start = NO_SECTION;
			self.state = State::BeforeAttributeName;
			self.state_before_attribute_name(c);
		}
	}

	fn state_before_closing_tag_name(&mut self, c: u8) {
		if is_whitespace(c) {
			self.state = State::InSpecialComment;
			self.section_start = self.index;
		} else if c == GT {
			self.state = State::Text;
			self.section_start = self.index + 1;
		} else {
			self.state = if is_ascii_alpha(c) {
				State::InClosingTagName
			} else {
				State::InSpecialComment
			};
			self.section_start = self.index;
		}
	}

	fn state_in_closing_tag_name(&mut self, c: u8) {
		if is_end_of_tag_section(c) {
			self.cbs.on_close_tag(self.section_start, self.index);
			self.section_start = NO_SECTION;
			self.state = State::AfterClosingTagName;
			self.state_after_closing_tag_name(c);
		}
	}

	fn state_after_closing_tag_name(&mut self, c: u8) {
		if c == GT || self.fast_forward_to(GT) {
			self.state = State::Text;
			self.section_start = self.index + 1;
		}
	}

	fn state_before_attribute_name(&mut self, c: u8) {
		if c == GT {
			self.cbs.on_open_tag_end(self.index);
			self.enter_tag_body();
			self.section_start = self.index + 1;
		} else if c == SLASH {
			self.state = State::InSelfClosingTag;
		} else if !is_whitespace(c) {
			self.state = State::InAttributeName;
			self.section_start = self.index;
		}
	}

	fn state_in_self_closing_tag(&mut self, c: u8) {
		if c == GT {
			self.cbs.on_self_closing_tag(self.index);
			self.section_start = self.index + 1;
			self.enter_tag_body();
		} else if !is_whitespace(c) {
			self.state = State::BeforeAttributeName;
			self.state_before_attribute_name(c);
		}
	}

	fn state_in_attribute_name(&mut self, c: u8) {
		if c == EQ || is_end_of_tag_section(c) {
			self.cbs.on_attrib_name(self.section_start, self.index);
			self.section_start = self.index;
			self.state = State::AfterAttributeName;
			self.state_after_attribute_name(c);
		}
	}

	fn state_after_attribute_name(&mut self, c: u8) {
		if c == EQ {
			self.state = State::BeforeAttributeValue;
		} else if c == SLASH || c == GT {
			self.cbs
				.on_attrib_end(QuoteType::NoValue, self.section_start);
			self.section_start = NO_SECTION;
			self.state = State::BeforeAttributeName;
			self.state_before_attribute_name(c);
		} else if !is_whitespace(c) {
			self.cbs
				.on_attrib_end(QuoteType::NoValue, self.section_start);
			self.state = State::InAttributeName;
			self.section_start = self.index;
		}
	}

	fn state_before_attribute_value(&mut self, c: u8) {
		if c == DOUBLE_QUOTE {
			self.state = State::InAttributeValueDq;
			self.section_start = self.index + 1;
			self.cbs.on_attrib_value_start(self.section_start);
		} else if c == SINGLE_QUOTE {
			self.state = State::InAttributeValueSq;
			self.section_start = self.index + 1;
			self.cbs.on_attrib_value_start(self.section_start);
		} else if !is_whitespace(c) {
			self.section_start = self.index;
			self.cbs.on_attrib_value_start(self.section_start);
			self.state = State::InAttributeValueNq;
			self.state_in_attribute_value_no_quotes(c);
		}
	}

	fn handle_in_attribute_value(&mut self, c: u8, quote: u8) {
		if c == quote {
			self.cbs.on_attrib_data(self.section_start, self.index);
			self.section_start = NO_SECTION;
			self.cbs.on_attrib_end(
				if quote == DOUBLE_QUOTE {
					QuoteType::Double
				} else {
					QuoteType::Single
				},
				self.index + 1,
			);
			self.state = State::BeforeAttributeName;
		} else if c == AMP {
			self.start_entity();
		}
	}

	fn state_in_attribute_value_no_quotes(&mut self, c: u8) {
		if is_whitespace(c) || c == GT {
			self.cbs.on_attrib_data(self.section_start, self.index);
			self.section_start = NO_SECTION;
			self.cbs.on_attrib_end(QuoteType::Unquoted, self.index);
			self.state = State::BeforeAttributeName;
			self.state_before_attribute_name(c);
		} else if c == AMP {
			self.start_entity();
		}
	}

	fn state_before_declaration(&mut self, c: u8) {
		if c == OPENING_SQUARE_BRACKET {
			self.state = State::CdataSequence;
			self.sequence_index = 0;
		} else if c | 0x20 == b'd' {
			self.state = State::DeclarationSequence;
			self.current_sequence = Sequence::Doctype;
			self.sequence_index = 1;
		} else if c == GT {
			self.cbs.on_comment(self.section_start, self.index, 0);
			self.state = State::Text;
			self.section_start = self.index + 1;
		} else if c == DASH {
			self.state = State::BeforeComment;
		} else {
			self.state = State::InSpecialComment;
		}
	}

	fn state_declaration_sequence(&mut self, c: u8) {
		if self.sequence_index == self.current_sequence.len() {
			self.state = State::InDeclaration;
			self.state_in_declaration(c);
		} else if Some(c | 0x20) == self.current_sequence.at(self.sequence_index) {
			self.sequence_index += 1;
		} else if c == GT {
			self.cbs.on_comment(self.section_start, self.index, 0);
			self.state = State::Text;
			self.section_start = self.index + 1;
		} else {
			self.state = State::InSpecialComment;
		}
	}

	fn state_in_declaration(&mut self, c: u8) {
		if c == GT || self.fast_forward_to(GT) {
			self.cbs.on_declaration(self.section_start, self.index);
			self.state = State::Text;
			self.section_start = self.index + 1;
		}
	}

	fn state_before_comment(&mut self, c: u8) {
		if c == DASH {
			self.state = State::InCommentLike;
			self.current_sequence = Sequence::CommentEnd;
			self.sequence_index = 0;
			self.section_start = self.index + 1;
		} else if c == GT {
			self.cbs.on_comment(self.section_start, self.index, 0);
			self.state = State::Text;
			self.section_start = self.index + 1;
		} else {
			self.state = State::InSpecialComment;
		}
	}

	fn state_in_special_comment(&mut self, c: u8) {
		if c == GT || self.fast_forward_to(GT) {
			self.cbs.on_comment(self.section_start, self.index, 0);
			self.state = State::Text;
			self.section_start = self.index + 1;
		}
	}

	fn start_entity(&mut self) {
		self.base_state = self.state;
		self.state = State::InEntity;
		self.entity_start = self.index;
		self.entity_decoder.start_entity(
			if self.base_state == State::Text || self.base_state == State::InSpecialTag {
				DecodingMode::Legacy
			} else {
				DecodingMode::Attribute
			},
		);
	}

	fn state_in_entity(&mut self) {
		let mut emitted = Emitted::default();
		let result = self
			.entity_decoder
			.write(self.buffer, self.index, &mut emitted);
		self.apply_emitted(&emitted);
		match result {
			WriteResult::Consumed(length) => {
				self.state = self.base_state;
				if length == 0 {
					self.index -= 1;
				}
			}
			WriteResult::Incomplete => {
				if self.buffer.get(self.index) == Some(&AMP) {
					self.state = self.base_state;
					self.index -= 1;
					return;
				}
				self.index = self.len() - 1;
			}
		}
	}

	fn cleanup(&mut self) {
		if self.section_start != self.index {
			if self.state == State::Text
				|| self.state == State::InPlainText
				|| (self.state == State::InSpecialTag && self.sequence_index == 0)
			{
				self.cbs.on_text(self.section_start, self.index);
				self.section_start = self.index;
			} else if matches!(
				self.state,
				State::InAttributeValueDq | State::InAttributeValueSq | State::InAttributeValueNq
			) {
				self.cbs.on_attrib_data(self.section_start, self.index);
				self.section_start = self.index;
			}
		}
	}

	fn parse(&mut self) {
		while self.index < self.len() {
			let c = self.buffer[self.index];
			match self.state {
				State::Text => self.state_text(c),
				State::InPlainText => self.index = self.len() - 1,
				State::SpecialStartSequence => self.state_special_start_sequence(c),
				State::InSpecialTag => self.state_in_special_tag(c),
				State::CdataSequence => self.state_cdata_sequence(c),
				State::DeclarationSequence => self.state_declaration_sequence(c),
				State::InAttributeValueDq => self.handle_in_attribute_value(c, DOUBLE_QUOTE),
				State::InAttributeName => self.state_in_attribute_name(c),
				State::InCommentLike => self.state_in_comment_like(c),
				State::InSpecialComment => self.state_in_special_comment(c),
				State::BeforeAttributeName => self.state_before_attribute_name(c),
				State::InTagName => self.state_in_tag_name(c),
				State::InClosingTagName => self.state_in_closing_tag_name(c),
				State::BeforeTagName => self.state_before_tag_name(c),
				State::AfterAttributeName => self.state_after_attribute_name(c),
				State::InAttributeValueSq => self.handle_in_attribute_value(c, SINGLE_QUOTE),
				State::BeforeAttributeValue => self.state_before_attribute_value(c),
				State::BeforeClosingTagName => self.state_before_closing_tag_name(c),
				State::AfterClosingTagName => self.state_after_closing_tag_name(c),
				State::InAttributeValueNq => self.state_in_attribute_value_no_quotes(c),
				State::InSelfClosingTag => self.state_in_self_closing_tag(c),
				State::InDeclaration => self.state_in_declaration(c),
				State::BeforeDeclaration => self.state_before_declaration(c),
				State::BeforeComment => self.state_before_comment(c),
				State::InEntity => self.state_in_entity(),
			}
			self.index += 1;
		}
		self.cleanup();
	}

	fn finish(&mut self) {
		if self.state == State::InEntity {
			let mut emitted = Emitted::default();
			self.entity_decoder.end(&mut emitted);
			self.apply_emitted(&emitted);
			self.state = self.base_state;
		}
		self.handle_trailing_data();
		self.cbs.on_end();
	}

	fn handle_trailing_comment_like_data(&mut self, end_index: usize) -> bool {
		if self.state != State::InCommentLike {
			return false;
		}
		if self.current_sequence == Sequence::CdataEnd {
			let cdata_start = self.section_start - Sequence::Cdata.len() - 1;
			self.cbs.on_comment(cdata_start, end_index, 0);
		} else {
			let offset = self.sequence_index.min(Sequence::CommentEnd.len() - 1);
			self.cbs.on_comment(self.section_start, end_index, offset);
		}
		true
	}

	fn handle_trailing_markup_declaration(&mut self, end_index: usize) -> bool {
		match self.state {
			State::BeforeDeclaration
			| State::InSpecialComment
			| State::BeforeComment
			| State::CdataSequence => {
				self.cbs.on_comment(self.section_start, end_index, 0);
				true
			}
			State::DeclarationSequence => {
				if self.sequence_index != Sequence::Doctype.len() {
					self.cbs.on_comment(self.section_start, end_index, 0);
				}
				true
			}
			State::InDeclaration => true,
			_ => false,
		}
	}

	fn handle_trailing_data(&mut self) {
		let end_index = self.len();
		if self.handle_trailing_comment_like_data(end_index)
			|| self.handle_trailing_markup_declaration(end_index)
		{
			return;
		}
		// htmlparser2's `-1` ("no section") is below every index, so it falls
		// through to the text callback below — which moves the parser's
		// `startIndex` to the end even though no text exists.
		if self.section_start != NO_SECTION && self.section_start >= end_index {
			return;
		}
		match self.state {
			State::InTagName
			| State::BeforeAttributeName
			| State::BeforeAttributeValue
			| State::AfterAttributeName
			| State::InAttributeName
			| State::InAttributeValueSq
			| State::InAttributeValueDq
			| State::InAttributeValueNq
			| State::InClosingTagName => {}
			_ => self.cbs.on_text(self.section_start, end_index),
		}
	}

	/// `emitCodePoint`, applied once per decoded code point.
	fn apply_emitted(&mut self, emitted: &Emitted) {
		for &code_point in &emitted.code_points[..emitted.count] {
			if self.base_state != State::Text && self.base_state != State::InSpecialTag {
				if self.section_start < self.entity_start {
					self.cbs
						.on_attrib_data(self.section_start, self.entity_start);
				}
				self.section_start = self.entity_start + emitted.consumed;
				self.index = self.section_start - 1;
				self.cbs.on_attrib_entity(code_point);
			} else {
				if self.section_start < self.entity_start {
					self.cbs.on_text(self.section_start, self.entity_start);
				}
				self.section_start = self.entity_start + emitted.consumed;
				self.index = self.section_start - 1;
				self.cbs.on_text_entity(code_point, self.section_start);
			}
		}
	}
}

fn memchr(needle: u8, haystack: &[u8]) -> Option<usize> {
	haystack.iter().position(|&byte| byte == needle)
}
