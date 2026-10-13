//! Character-reference decoding exactly as `entities` 8.0.0's `EntityDecoder`
//! performs it for htmlparser2 — including its legacy (semicolon-less)
//! references and its attribute-value restrictions, which differ from the
//! WHATWG tables in places a spec-conformant decoder would not reproduce.

// cspell:ignore ampx

use crate::html_decode_tree::HTML_DECODE_TREE;

const VALUE_LENGTH: u16 = 0b1100_0000_0000_0000;
const FLAG13: u16 = 0b0010_0000_0000_0000;
const BRANCH_LENGTH: u16 = 0b0001_1111_1000_0000;
const JUMP_TABLE: u16 = 0b0000_0000_0111_1111;

const NUM: u8 = b'#';
const SEMI: u8 = b';';
const EQUALS: u8 = b'=';
const TO_LOWER_BIT: u8 = 0b10_0000;

/// Where a reference sits, which decides whether a semicolon-less named
/// reference is decoded.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum DecodingMode {
	/// Text content: any legacy reference decodes.
	Legacy,
	/// Attribute values: a legacy reference followed by `=` or an
	/// alphanumeric is left as text.
	Attribute,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum State {
	EntityStart,
	NumericStart,
	NumericDecimal,
	NumericHex,
	NamedEntity,
}

/// The code points one decoded reference produced, and how many input bytes
/// (counting the leading `&`) it consumed. A named reference can stand for
/// two code points; `entities` reports them in two calls sharing `consumed`.
#[derive(Clone, Copy, Default, Debug)]
pub(crate) struct Emitted {
	pub code_points: [u32; 2],
	pub count: usize,
	pub consumed: usize,
}

impl Emitted {
	fn push(&mut self, code_point: u32, consumed: usize) {
		self.code_points[self.count] = code_point;
		self.count += 1;
		self.consumed = consumed;
	}
}

/// What a call to [`EntityDecoder::write`] concluded.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum WriteResult {
	/// The input ended before the reference did.
	Incomplete,
	/// The reference ended; `0` means it was not a reference at all.
	Consumed(usize),
}

fn is_number(code: u8) -> bool {
	code.is_ascii_digit()
}

fn is_hexadecimal_character(code: u8) -> bool {
	matches!(code, b'A'..=b'F' | b'a'..=b'f')
}

fn is_entity_in_attribute_invalid_end(code: u8) -> bool {
	code == EQUALS || code.is_ascii_alphanumeric()
}

/// `replaceCodePoint`: the WHATWG numeric-reference fix-ups (C1 controls read
/// as windows-1252, surrogates / out-of-range / NUL as U+FFFD).
fn replace_code_point(code_point: u64) -> u32 {
	if (0xD800..=0xDFFF).contains(&code_point) || code_point > 0x10_FFFF {
		return 0xFFFD;
	}
	match code_point {
		0 => 0xFFFD,
		128 => 8364,
		130 => 8218,
		131 => 402,
		132 => 8222,
		133 => 8230,
		134 => 8224,
		135 => 8225,
		136 => 710,
		137 => 8240,
		138 => 352,
		139 => 8249,
		140 => 338,
		142 => 381,
		145 => 8216,
		146 => 8217,
		147 => 8220,
		148 => 8221,
		149 => 8226,
		150 => 8211,
		151 => 8212,
		152 => 732,
		153 => 8482,
		154 => 353,
		155 => 8250,
		156 => 339,
		158 => 382,
		159 => 376,
		// Lossless: every value reaching here is at most 0x10FFFF.
		other => u32::try_from(other).unwrap_or(0xFFFD),
	}
}

fn tree(index: usize) -> u16 {
	HTML_DECODE_TREE[index]
}

/// `determineBranch`: the trie node reached from `current` on `char`, or
/// `None` when no branch matches.
fn determine_branch(current: u16, node_index: usize, char: u8) -> Option<usize> {
	let branch_count = usize::from((current & BRANCH_LENGTH) >> 7);
	let jump_offset = current & JUMP_TABLE;
	let char = u16::from(char);

	if branch_count == 0 {
		return (jump_offset != 0 && char == jump_offset).then_some(node_index);
	}

	if jump_offset != 0 {
		let value = usize::from(char.checked_sub(jump_offset)?);
		if value >= branch_count {
			return None;
		}
		return usize::from(tree(node_index + value)).checked_sub(1);
	}

	let packed_key_slots = (branch_count + 1) >> 1;
	let mut lo = 0usize;
	let mut hi = branch_count;
	while lo < hi {
		let mid = usize::midpoint(lo, hi);
		let slot = mid >> 1;
		let packed = tree(node_index + slot);
		let mid_key = (packed >> ((mid & 1) * 8)) & 0xFF;
		match mid_key.cmp(&char) {
			std::cmp::Ordering::Less => lo = mid + 1,
			std::cmp::Ordering::Greater => hi = mid,
			std::cmp::Ordering::Equal => {
				return Some(usize::from(tree(node_index + packed_key_slots + mid)));
			}
		}
	}
	None
}

/// A resumable decoder for one reference at a time (the part after `&`).
#[derive(Debug)]
pub(crate) struct EntityDecoder {
	state: State,
	consumed: usize,
	result: usize,
	tree_index: usize,
	excess: usize,
	decode_mode: DecodingMode,
	run_consumed: usize,
	numeric_result: u64,
}

impl Default for EntityDecoder {
	fn default() -> Self {
		Self {
			state: State::EntityStart,
			consumed: 1,
			result: 0,
			tree_index: 0,
			excess: 1,
			decode_mode: DecodingMode::Legacy,
			run_consumed: 0,
			numeric_result: 0,
		}
	}
}

impl EntityDecoder {
	/// Resets the decoder for a reference whose `&` was just read.
	pub(crate) fn start_entity(&mut self, decode_mode: DecodingMode) {
		*self = Self {
			decode_mode,
			..Self::default()
		};
	}

	/// Feeds `input[offset..]` (the bytes after `&`).
	pub(crate) fn write(&mut self, input: &[u8], offset: usize, out: &mut Emitted) -> WriteResult {
		match self.state {
			State::EntityStart => {
				if input.get(offset) == Some(&NUM) {
					self.state = State::NumericStart;
					self.consumed += 1;
					return self.state_numeric_start(input, offset + 1, out);
				}
				self.state = State::NamedEntity;
				self.state_named_entity(input, offset, out)
			}
			State::NumericStart => self.state_numeric_start(input, offset, out),
			State::NumericDecimal => self.state_numeric_decimal(input, offset, out),
			State::NumericHex => self.state_numeric_hex(input, offset, out),
			State::NamedEntity => self.state_named_entity(input, offset, out),
		}
	}

	fn state_numeric_start(
		&mut self,
		input: &[u8],
		offset: usize,
		out: &mut Emitted,
	) -> WriteResult {
		let Some(&char) = input.get(offset) else {
			return WriteResult::Incomplete;
		};
		if char | TO_LOWER_BIT == b'x' {
			self.state = State::NumericHex;
			self.consumed += 1;
			return self.state_numeric_hex(input, offset + 1, out);
		}
		self.state = State::NumericDecimal;
		self.state_numeric_decimal(input, offset, out)
	}

	fn state_numeric_hex(
		&mut self,
		input: &[u8],
		mut offset: usize,
		out: &mut Emitted,
	) -> WriteResult {
		while let Some(&char) = input.get(offset) {
			if is_number(char) || is_hexadecimal_character(char) {
				let digit = if char <= b'9' {
					char - b'0'
				} else {
					(char | TO_LOWER_BIT) - b'a' + 10
				};
				// Saturating: once past 0x10FFFF the value only ever maps to U+FFFD.
				self.numeric_result = self
					.numeric_result
					.saturating_mul(16)
					.saturating_add(u64::from(digit));
				self.consumed += 1;
				offset += 1;
			} else {
				return WriteResult::Consumed(self.emit_numeric_entity(Some(char), 3, out));
			}
		}
		WriteResult::Incomplete
	}

	fn state_numeric_decimal(
		&mut self,
		input: &[u8],
		mut offset: usize,
		out: &mut Emitted,
	) -> WriteResult {
		while let Some(&char) = input.get(offset) {
			if is_number(char) {
				self.numeric_result = self
					.numeric_result
					.saturating_mul(10)
					.saturating_add(u64::from(char - b'0'));
				self.consumed += 1;
				offset += 1;
			} else {
				return WriteResult::Consumed(self.emit_numeric_entity(Some(char), 2, out));
			}
		}
		WriteResult::Incomplete
	}

	/// `last` is `None` at the end of the input (`entities` passes `0` there).
	fn emit_numeric_entity(
		&mut self,
		last: Option<u8>,
		expected_length: usize,
		out: &mut Emitted,
	) -> usize {
		if self.consumed <= expected_length {
			return 0;
		}
		if last == Some(SEMI) {
			self.consumed += 1;
		}
		// `DecodingMode::Strict` (the only mode rejecting a semicolon-less
		// numeric reference) is XML-only, so it never reaches here.
		out.push(replace_code_point(self.numeric_result), self.consumed);
		self.consumed
	}

	fn state_named_entity(
		&mut self,
		input: &[u8],
		mut offset: usize,
		out: &mut Emitted,
	) -> WriteResult {
		let mut current = tree(self.tree_index);
		let mut value_length = (current & VALUE_LENGTH) >> 14;

		while offset < input.len() {
			if value_length == 0 && current & FLAG13 != 0 {
				let run_length = usize::from((current & BRANCH_LENGTH) >> 7);

				if self.run_consumed == 0 {
					let first_char = current & JUMP_TABLE;
					if u16::from(input[offset]) != first_char {
						return WriteResult::Consumed(self.not_terminated_or_zero(out));
					}
					offset += 1;
					self.excess += 1;
					self.run_consumed += 1;
				}

				while self.run_consumed < run_length {
					let Some(&char) = input.get(offset) else {
						return WriteResult::Incomplete;
					};
					let char_index_in_packed = self.run_consumed - 1;
					let packed_word = tree(self.tree_index + 1 + (char_index_in_packed >> 1));
					let expected_char = if char_index_in_packed.is_multiple_of(2) {
						packed_word & 0xFF
					} else {
						(packed_word >> 8) & 0xFF
					};
					if u16::from(char) != expected_char {
						self.run_consumed = 0;
						return WriteResult::Consumed(self.not_terminated_or_zero(out));
					}
					offset += 1;
					self.excess += 1;
					self.run_consumed += 1;
				}

				self.run_consumed = 0;
				self.tree_index += 1 + (run_length >> 1);
				current = tree(self.tree_index);
				value_length = (current & VALUE_LENGTH) >> 14;
			}

			let Some(&char) = input.get(offset) else {
				break;
			};

			if char == SEMI && value_length != 0 && current & FLAG13 != 0 {
				return WriteResult::Consumed(Self::emit_named_entity_data(
					self.tree_index,
					value_length,
					self.consumed + self.excess,
					out,
				));
			}

			let Some(next) = determine_branch(
				current,
				self.tree_index + usize::from(value_length).max(1),
				char,
			) else {
				let decline = self.result == 0
					|| (self.decode_mode == DecodingMode::Attribute
						&& (value_length == 0 || is_entity_in_attribute_invalid_end(char)));
				return WriteResult::Consumed(if decline {
					0
				} else {
					self.emit_not_terminated_named_entity(out)
				});
			};
			self.tree_index = next;

			current = tree(self.tree_index);
			value_length = (current & VALUE_LENGTH) >> 14;

			if value_length != 0 {
				if char == SEMI {
					return WriteResult::Consumed(Self::emit_named_entity_data(
						self.tree_index,
						value_length,
						self.consumed + self.excess,
						out,
					));
				}
				if current & FLAG13 == 0 {
					self.result = self.tree_index;
					self.consumed += self.excess;
					self.excess = 0;
				}
			}
			offset += 1;
			self.excess += 1;
		}

		WriteResult::Incomplete
	}

	fn not_terminated_or_zero(&mut self, out: &mut Emitted) -> usize {
		if self.result == 0 {
			0
		} else {
			self.emit_not_terminated_named_entity(out)
		}
	}

	fn emit_not_terminated_named_entity(&mut self, out: &mut Emitted) -> usize {
		let value_length = (tree(self.result) & VALUE_LENGTH) >> 14;
		Self::emit_named_entity_data(self.result, value_length, self.consumed, out);
		self.consumed
	}

	fn emit_named_entity_data(
		result: usize,
		value_length: u16,
		consumed: usize,
		out: &mut Emitted,
	) -> usize {
		let first = if value_length == 1 {
			tree(result) & !(VALUE_LENGTH | FLAG13)
		} else {
			tree(result + 1)
		};
		out.push(u32::from(first), consumed);
		if value_length == 3 {
			out.push(u32::from(tree(result + 2)), consumed);
		}
		consumed
	}

	/// Signals the end of the input mid-reference; returns what was consumed.
	pub(crate) fn end(&mut self, out: &mut Emitted) -> usize {
		match self.state {
			State::NamedEntity => {
				if self.result != 0
					&& (self.decode_mode != DecodingMode::Attribute
						|| self.result == self.tree_index)
				{
					self.emit_not_terminated_named_entity(out)
				} else {
					0
				}
			}
			State::NumericDecimal => self.emit_numeric_entity(None, 2, out),
			State::NumericHex => self.emit_numeric_entity(None, 3, out),
			State::NumericStart | State::EntityStart => 0,
		}
	}
}

#[cfg(test)]
mod tests {
	use super::{DecodingMode, Emitted, EntityDecoder, WriteResult};
	use crate::html_decode_tree::HTML_DECODE_TREE;

	#[test]
	fn holds_the_decode_tree_of_entities_8_0_0() {
		// Length and FNV-1a 64 (over each value's little-endian bytes) of
		// entities@8.0.0's `htmlDecodeTree`, so a regenerated table that
		// differs from the one the stored keys were decoded with fails here.
		let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
		for value in HTML_DECODE_TREE {
			for byte in value.to_le_bytes() {
				hash ^= u64::from(byte);
				hash = hash.wrapping_mul(0x0100_0000_01b3);
			}
		}
		assert_eq!(HTML_DECODE_TREE.len(), 12_075);
		assert_eq!(hash, 0xfee1_a3ba_3b21_b3bc);
	}

	/// Decodes the reference starting right after the `&` at the front of
	/// `input`, the way the tokenizer feeds it.
	fn decode(input: &str, mode: DecodingMode) -> (WriteResult, Vec<u32>) {
		let mut decoder = EntityDecoder::default();
		decoder.start_entity(mode);
		let mut out = Emitted::default();
		let result = decoder.write(input.as_bytes(), 1, &mut out);
		(result, out.code_points[..out.count].to_vec())
	}

	#[test]
	fn decodes_a_terminated_named_reference() {
		assert_eq!(
			decode("&amp;x", DecodingMode::Legacy),
			(WriteResult::Consumed(5), vec![u32::from('&')])
		);
	}

	#[test]
	fn decodes_a_legacy_reference_without_semicolon_in_text() {
		assert_eq!(
			decode("&ampx", DecodingMode::Legacy),
			(WriteResult::Consumed(4), vec![u32::from('&')])
		);
	}

	#[test]
	fn leaves_a_legacy_reference_followed_by_alphanumerics_in_an_attribute() {
		assert_eq!(
			decode("&ampx", DecodingMode::Attribute),
			(WriteResult::Consumed(0), vec![])
		);
		assert_eq!(
			decode("&amp=", DecodingMode::Attribute),
			(WriteResult::Consumed(0), vec![])
		);
	}

	#[test]
	fn decodes_a_legacy_reference_followed_by_punctuation_in_an_attribute() {
		assert_eq!(
			decode("&amp\"", DecodingMode::Attribute),
			(WriteResult::Consumed(4), vec![u32::from('&')])
		);
	}

	#[test]
	fn decodes_numeric_references_with_the_whatwg_fix_ups() {
		assert_eq!(
			decode("&#65;", DecodingMode::Legacy),
			(WriteResult::Consumed(5), vec![65])
		);
		assert_eq!(
			decode("&#x41 ", DecodingMode::Legacy),
			(WriteResult::Consumed(5), vec![65])
		);
		assert_eq!(decode("&#128;", DecodingMode::Legacy).1, vec![8364]);
		assert_eq!(decode("&#0;", DecodingMode::Legacy).1, vec![0xFFFD]);
		assert_eq!(decode("&#xD800;", DecodingMode::Legacy).1, vec![0xFFFD]);
		assert_eq!(
			decode("&#99999999999999999999;", DecodingMode::Legacy).1,
			vec![0xFFFD]
		);
	}

	#[test]
	fn rejects_a_numeric_reference_without_digits() {
		assert_eq!(
			decode("&#;", DecodingMode::Legacy),
			(WriteResult::Consumed(0), vec![])
		);
		assert_eq!(
			decode("&#x;", DecodingMode::Legacy),
			(WriteResult::Consumed(0), vec![])
		);
	}

	#[test]
	fn reports_two_code_points_for_a_multi_code_point_reference() {
		// &NotEqualTilde; is U+2242 U+0338.
		assert_eq!(
			decode("&NotEqualTilde;", DecodingMode::Legacy).1,
			vec![0x2242, 0x0338]
		);
	}

	#[test]
	fn reports_an_astral_reference_as_a_surrogate_pair() {
		// &Afr; is U+1D504, stored (like a JS string) as its UTF-16 halves.
		assert_eq!(
			decode("&Afr;", DecodingMode::Legacy).1,
			vec![0xD835, 0xDD04]
		);
	}

	#[test]
	fn is_incomplete_at_the_end_of_the_input() {
		assert_eq!(
			decode("&am", DecodingMode::Legacy),
			(WriteResult::Incomplete, vec![])
		);
	}

	#[test]
	fn ends_a_pending_legacy_reference() {
		let mut decoder = EntityDecoder::default();
		decoder.start_entity(DecodingMode::Legacy);
		let mut out = Emitted::default();
		assert_eq!(decoder.write(b"&amp", 1, &mut out), WriteResult::Incomplete);
		assert_eq!(decoder.end(&mut out), 4);
		assert_eq!(out.code_points[..out.count], [u32::from('&')]);
	}
}
