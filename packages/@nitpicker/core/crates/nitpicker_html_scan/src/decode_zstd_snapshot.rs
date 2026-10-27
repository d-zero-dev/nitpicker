use std::io::Read;

/// Bytes one zstd-compressed HTML snapshot may decompress to (about 1.5 GiB):
/// the `max_decoded_bytes` the addon's batch scans are given.
///
/// A snapshot past it is reported as undecodable instead of being held whole:
/// the size a zstd frame header states can be absent or false, so a stored
/// blob of a few kilobytes can otherwise expand to any size, on every thread
/// of a batch at once (RFC 8878, §8). The value is the most the crawler can
/// store, so no snapshot it stored is ever refused: a snapshot is the string
/// `page.content()` returns, saved as UTF-8, a V8 string holds at most
/// 2^29 − 24 UTF-16 code units, and one code unit takes at most 3 bytes of
/// UTF-8. Only a blob the crawler did not write can exceed it.
pub const MAX_DECODED_SNAPSHOT_BYTES: usize = 3 * ((1 << 29) - 24);

/// Bytes reserved up front at most, whatever size a frame header states. A
/// header is not checked until the bytes come out, so a few bytes of crafted
/// header must not make every thread reserve the full limit; a document
/// larger than this grows its buffer as it is read.
const MAX_RESERVATION: usize = 64 * 1024 * 1024;

/// Bytes decompressed between two looks at the cancel flag. Small next to a
/// snapshot worth cancelling (hundreds of mebibytes), so a cancelled call
/// stops long before such a snapshot is done; large enough that the look
/// costs nothing next to the decompression.
const READ_STEP: usize = 1024 * 1024;

/// Why a zstd snapshot was not decompressed.
#[derive(Debug)]
pub(crate) enum ZstdDecodeStop {
	/// The data is not valid zstd.
	Corrupt(std::io::Error),
	/// The document is larger than the limit.
	TooLarge,
	/// `cancelled` answered `true`.
	Cancelled,
}

/// The bytes to reserve before decompressing `body`: the size its first frame
/// states, at most `allowed` and at most [`MAX_RESERVATION`], or none when it
/// states no size.
///
/// A frame that states its size gets its buffer at once: growing by doubling
/// would reallocate and copy along the way and could leave up to twice the
/// document's size reserved. The stated size is trusted only for this
/// reservation, and only up to those two caps; the bytes that come out are
/// still counted against the limit.
fn initial_reservation(body: &[u8], allowed: u64) -> usize {
	let stated = zstd::zstd_safe::get_frame_content_size(body)
		.ok()
		.flatten()
		.unwrap_or(0);
	usize::try_from(stated.min(allowed))
		.unwrap_or(usize::MAX)
		.min(MAX_RESERVATION)
}

/// Decompresses one zstd snapshot (every frame of it, as one document), at
/// most `max_decoded_bytes` of it, asking `cancelled` before every step of
/// [`READ_STEP`] bytes.
///
/// The decompression is read step by step instead of in one call
/// (`zstd::stream::decode_all`) for two reasons. The size a frame header
/// states can be absent or false, so only counting the bytes as they come out
/// bounds the memory one snapshot takes: reading stops one byte past the
/// limit. And a single snapshot can take seconds to decompress, so a
/// cancellation has to be seen inside it, not only between snapshots.
pub(crate) fn decode_zstd_snapshot(
	body: &[u8],
	max_decoded_bytes: usize,
	cancelled: impl Fn() -> bool,
) -> Result<Vec<u8>, ZstdDecodeStop> {
	let mut decoder =
		zstd::stream::read::Decoder::with_buffer(body).map_err(ZstdDecodeStop::Corrupt)?;
	// One byte past the limit is enough to know the document exceeds it.
	let allowed = (max_decoded_bytes as u64).saturating_add(1);
	let mut document = Vec::new();
	// A reservation the allocator refuses (a false header on a system that
	// does not overcommit) is not an error: the buffer just grows as it fills.
	let _ = document.try_reserve_exact(initial_reservation(body, allowed));
	loop {
		if cancelled() {
			return Err(ZstdDecodeStop::Cancelled);
		}
		let step = (allowed - document.len() as u64).min(READ_STEP as u64);
		let read = (&mut decoder)
			.take(step)
			.read_to_end(&mut document)
			.map_err(ZstdDecodeStop::Corrupt)?;
		if document.len() > max_decoded_bytes {
			return Err(ZstdDecodeStop::TooLarge);
		}
		if read == 0 {
			return Ok(document);
		}
	}
}

#[cfg(test)]
mod tests {
	use std::cell::Cell;

	use super::{
		MAX_RESERVATION, READ_STEP, ZstdDecodeStop, decode_zstd_snapshot, initial_reservation,
	};

	fn zstd(bytes: &[u8]) -> Vec<u8> {
		zstd::stream::encode_all(bytes, 3).unwrap()
	}

	fn never() -> bool {
		false
	}

	#[test]
	fn decompresses_a_document_of_exactly_the_limit() {
		let document = vec![b'a'; 1024];
		let decoded = decode_zstd_snapshot(&zstd(&document), 1024, never).unwrap();
		assert_eq!(decoded, document);
	}

	#[test]
	fn stops_a_document_one_byte_past_the_limit() {
		let stop = decode_zstd_snapshot(&zstd(&[b'a'; 1025]), 1024, never).unwrap_err();
		assert!(matches!(stop, ZstdDecodeStop::TooLarge));
	}

	#[test]
	fn counts_concatenated_frames_as_one_document_against_the_limit() {
		let mut body = zstd(&[b'a'; 600]);
		body.extend(zstd(&[b'b'; 600]));
		let stop = decode_zstd_snapshot(&body, 1024, never).unwrap_err();
		assert!(matches!(stop, ZstdDecodeStop::TooLarge));
		let decoded = decode_zstd_snapshot(&body, 1200, never).unwrap();
		assert_eq!(decoded.len(), 1200);
	}

	#[test]
	fn a_frame_that_states_no_size_is_still_stopped_at_the_limit() {
		// Without a stated size the header says nothing; the limit counts what comes out.
		let mut encoder = zstd::stream::write::Encoder::new(Vec::new(), 3).unwrap();
		encoder.include_contentsize(false).unwrap();
		std::io::Write::write_all(&mut encoder, &[b'a'; 4096]).unwrap();
		let body = encoder.finish().unwrap();
		let stop = decode_zstd_snapshot(&body, 1024, never).unwrap_err();
		assert!(matches!(stop, ZstdDecodeStop::TooLarge));
	}

	#[test]
	fn reports_data_that_is_not_zstd_as_corrupt() {
		let stop = decode_zstd_snapshot(b"not zstd", 1024, never).unwrap_err();
		assert!(matches!(stop, ZstdDecodeStop::Corrupt(_)));
	}

	#[test]
	fn looks_at_the_cancel_flag_between_steps_of_one_document() {
		// Three steps' worth of output: the flag is asked before each step.
		let document = vec![b'a'; 3 * READ_STEP];
		let asked = Cell::new(0);
		let stop = decode_zstd_snapshot(&zstd(&document), usize::MAX, || {
			asked.set(asked.get() + 1);
			asked.get() == 2
		})
		.unwrap_err();
		assert!(matches!(stop, ZstdDecodeStop::Cancelled));
		assert_eq!(asked.get(), 2);
	}

	#[test]
	fn a_flag_raised_before_it_starts_decompresses_nothing() {
		let stop = decode_zstd_snapshot(&zstd(b"<img>"), 1024, || true).unwrap_err();
		assert!(matches!(stop, ZstdDecodeStop::Cancelled));
	}

	#[test]
	fn reserves_exactly_the_size_a_frame_states() {
		let document = vec![b'a'; 3 * READ_STEP + 7];
		// One-shot compression writes the size into the frame header (the
		// streaming `encode_all` does not).
		let body = zstd::bulk::compress(&document, 3).unwrap();
		let decoded = decode_zstd_snapshot(&body, usize::MAX, never).unwrap();
		// Growing by doubling would end at 4 MiB; reserving up front leaves at
		// most what the allocator rounds up.
		assert!(decoded.capacity() - document.len() < READ_STEP);
	}

	#[test]
	fn reserves_the_stated_size_but_no_more_than_the_limit() {
		let stated = zstd::bulk::compress(&[b'a'; 4096], 3).unwrap();
		assert_eq!(initial_reservation(&stated, 1025), 1025);
		assert_eq!(initial_reservation(&stated, 8192), 4096);
	}

	#[test]
	fn reserves_no_more_than_the_up_front_cap_whatever_a_header_states() {
		// A bare frame header (magic, a single-segment descriptor with an 8-byte
		// content size) that states 1 GiB, with nothing after it.
		let mut header = vec![0x28, 0xb5, 0x2f, 0xfd, 0xe0];
		header.extend_from_slice(&(1_u64 << 30).to_le_bytes());
		assert_eq!(initial_reservation(&header, u64::MAX), MAX_RESERVATION);
	}

	#[test]
	fn reserves_nothing_for_a_frame_that_states_no_size_or_data_that_is_not_zstd() {
		assert_eq!(initial_reservation(&zstd(&[b'a'; 4096]), 8192), 0);
		assert_eq!(initial_reservation(b"not zstd", 8192), 0);
	}

	#[test]
	fn decompresses_the_whole_document_when_never_cancelled() {
		let document = vec![b'a'; 3 * READ_STEP + 7];
		let decoded = decode_zstd_snapshot(&zstd(&document), usize::MAX, never).unwrap();
		assert_eq!(decoded.len(), document.len());
	}
}
