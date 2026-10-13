/// FNV-1a over `codePointAt(i)` for every UTF-16 index `i` of `input` — at
/// a surrogate pair's first unit the whole code point, at its second the
/// low surrogate alone — the JavaScript loop the stored samples were seeded
/// with.
#[must_use]
pub fn fnv1a32(input: &str) -> u32 {
	let mut hash: u32 = 2_166_136_261;
	for c in input.chars() {
		let code_point = u32::from(c);
		hash ^= code_point;
		hash = hash.wrapping_mul(16_777_619);
		if code_point > 0xFFFF {
			let mut units = [0u16; 2];
			c.encode_utf16(&mut units);
			hash ^= u32::from(units[1]);
			hash = hash.wrapping_mul(16_777_619);
		}
	}
	hash
}

/// Mulberry32, seeded from a block key: the sampling sequence the stored
/// keys were computed with, number for number.
pub struct SeededRandom {
	state: u32,
}

impl SeededRandom {
	/// Seeds from `key` via [`fnv1a32`].
	#[must_use]
	pub fn from_key(key: &str) -> Self {
		Self {
			state: fnv1a32(key),
		}
	}

	/// The next value in `[0, 1)`.
	pub fn next_f64(&mut self) -> f64 {
		self.state = self.state.wrapping_add(1_831_565_813);
		let mut t = self.state;
		t = (t ^ (t >> 15)).wrapping_mul(t | 1);
		t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 0x3D));
		f64::from(t ^ (t >> 14)) / 4_294_967_296.0
	}
}

// Exact float comparisons on purpose: the stored keys depend on these
// values bit for bit, not approximately.
#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
	use super::{SeededRandom, fnv1a32};

	#[test]
	fn hashes_like_the_javascript_fnv1a() {
		// The FNV-1a 32-bit offset basis for the empty string, and the
		// published test vector for "a".
		assert_eq!(fnv1a32(""), 2_166_136_261);
		assert_eq!(fnv1a32("a"), 0xE40C_292C);
	}

	#[test]
	fn hashes_an_astral_character_at_both_of_its_utf16_indices() {
		// `fnv1a32` in `@nitpicker/archive`'s `reservoir-sample.ts` (a loop
		// over `codePointAt(i)`) gives these.
		assert_eq!(fnv1a32("path:\u{1F600}"), 793_062_020);
		assert_eq!(fnv1a32("path:\u{1F600}x"), 1_709_353_652);
	}

	#[test]
	fn reproduces_the_javascript_sequence() {
		// `mulberry32(1)` in `@nitpicker/archive`'s `reservoir-sample.ts` (and
		// the golden tests' seeded random) starts 0.6270739405881613,
		// 0.002735721180215478.
		let mut random = SeededRandom { state: 1 };
		assert_eq!(random.next_f64(), 0.627_073_940_588_161_3);
		assert_eq!(random.next_f64(), 0.002_735_721_180_215_478);
	}
}
