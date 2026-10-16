use napi::{Error, Result, Status};

/// Cuts `bytes` into the pieces `offsets` delimit and converts each piece:
/// `offsets` holds the `n + 1` positions that cut it into `n` pieces
/// (`offsets[i]..offsets[i + 1]`), so a million strings cross the boundary as
/// two buffers. One pass, one vector, and the first malformed piece or offset
/// is the error reported.
fn cut<'a, T>(
	bytes: &'a [u8],
	offsets: &[u32],
	convert: impl Fn(&'a [u8]) -> Result<T>,
) -> Result<Vec<T>> {
	let invalid = |reason: &str| Error::new(Status::InvalidArg, reason.to_owned());
	if offsets.first() != Some(&0) {
		return Err(invalid("offsets must start at 0"));
	}
	let mut pieces = Vec::with_capacity(offsets.len() - 1);
	for pair in offsets.windows(2) {
		let (start, end) = (pair[0] as usize, pair[1] as usize);
		if start > end || end > bytes.len() {
			return Err(invalid("offsets must ascend and stay within the bytes"));
		}
		pieces.push(convert(&bytes[start..end])?);
	}
	if offsets.last().map(|&end| end as usize) != Some(bytes.len()) {
		return Err(invalid("offsets must end at the length of the bytes"));
	}
	Ok(pieces)
}

/// Cuts `bytes` into the byte pieces `offsets` delimit.
///
/// # Errors
///
/// `InvalidArg` when `offsets` does not start at 0, does not ascend, runs
/// past `bytes` or stops short of its end.
pub fn slice_by_offsets<'a>(bytes: &'a [u8], offsets: &[u32]) -> Result<Vec<&'a [u8]>> {
	cut(bytes, offsets, Ok)
}

/// Cuts `bytes` into the UTF-8 strings `offsets` delimit.
///
/// # Errors
///
/// `InvalidArg` when `offsets` is malformed (see [`slice_by_offsets`]) or a
/// piece is not valid UTF-8.
pub fn slice_utf8_by_offsets<'a>(bytes: &'a [u8], offsets: &[u32]) -> Result<Vec<&'a str>> {
	cut(bytes, offsets, |piece| {
		std::str::from_utf8(piece).map_err(|_| {
			Error::new(
				Status::InvalidArg,
				"every URL must be valid UTF-8".to_owned(),
			)
		})
	})
}
