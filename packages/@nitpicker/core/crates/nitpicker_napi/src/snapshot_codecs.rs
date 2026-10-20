use napi::{Error, Result, Status};
use nitpicker_html_scan::SnapshotCodec;

/// Reads the codec byte of each snapshot of a batch: `0` stored as it is,
/// `1` zstd.
///
/// # Errors
///
/// `InvalidArg` for any other byte.
pub fn to_snapshot_codecs(codecs: &[u8]) -> Result<Vec<SnapshotCodec>> {
	codecs
		.iter()
		.map(|&codec| match codec {
			0 => Ok(SnapshotCodec::None),
			1 => Ok(SnapshotCodec::Zstd),
			other => Err(Error::new(
				Status::InvalidArg,
				format!("unknown snapshot codec: {other}"),
			)),
		})
		.collect()
}
