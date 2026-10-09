import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';

/**
 * Number of bytes hashed from each end of the file to corner the case
 * where two different archives share `size + mtime + ctime` by accident.
 *
 * 64 KiB is a sweet spot: on a 10 GB archive it reads 0.0006 % of the
 * file (~1 ms on an SSD, ~5 ms on a spinning disk) while reliably
 * sampling enough of both the tar leading header AND the tail (which
 * for tar archives contains the last-written entry's data, so any real
 * mutation moves at least one of the two windows).
 */
const HEAD_TAIL_HASH_BYTES = 64 * 1024;

/**
 * Cache-key segment substituted when a file is smaller than the
 * head+tail sample window. In that case the head segment alone already
 * spans the whole file (size column also rolls), so a separate tail
 * digest is meaningless and we encode that explicitly rather than
 * silently overlapping reads.
 */
const TAIL_NOT_NEEDED = 'short';

/**
 * Derive a stable cache key from a `.nitpicker` file's inode metadata
 * plus a head+tail content sample.
 *
 * Metadata fields:
 *
 * - `size` covers the bulk of accidental cache collision risk in O(1).
 * - `mtime` (mod time) changes whenever the file's content is rewritten,
 *   which is the common case (`crawl --append`, `crawl --retry-failed`,
 *   `cp -f`, rsync).
 * - `ctime` (inode change time) closes the `touch -m -t <past>` loophole:
 *   even if a user resets `mtime` to fake "unchanged", the act of touching
 *   bumps `ctime` on POSIX so the key still rolls.
 *
 * Head + tail digest:
 *
 * - On filesystems with low-resolution timestamps (FAT / exFAT / NFSv3 /
 *   some Docker volume mounts where mtime/ctime are second-granular and
 *   sometimes don't move on small appends), `size + mtime + ctime`
 *   alone can stay identical across an in-place rewrite.
 * - We hash the first {@link HEAD_TAIL_HASH_BYTES} bytes and the last
 *   {@link HEAD_TAIL_HASH_BYTES} bytes to detect this. For tar archives
 *   the head holds the first entry's header (which moves when the inner
 *   directory's name changes) and the tail holds the last entry's data
 *   (which always moves on `crawl --append` because the appended pages
 *   land near the end of the tar stream).
 * - Full-content sha256 was rejected: ~20-30 s on a 10 GB archive,
 *   which is slower than the untar this cache is meant to avoid.
 *
 * The key is stable across symlinks (the caller resolves via
 * `fs.realpath` upstream) but **not** across hardlinks pointing at a
 * mutated inode — that is intentional, hardlinking is a power-user
 * move and the user is expected to know the cache will share an entry.
 * @param archivePath - Absolute path to the `.nitpicker` file.
 * @returns A string of the form
 *   `<size>-<mtime_ns>-<ctime_ns>-<headHex>-<tailHex>` suitable for use
 *   as a directory-name component.
 */
export async function computeArchiveCacheKey(archivePath: string): Promise<string> {
	const stats = await fs.stat(archivePath, { bigint: true });
	const fileSize = Number(stats.size);
	const headHex = await sha256OfRange(
		archivePath,
		0,
		Math.min(HEAD_TAIL_HASH_BYTES, fileSize),
	);
	const tailHex =
		fileSize > HEAD_TAIL_HASH_BYTES
			? await sha256OfRange(
					archivePath,
					fileSize - HEAD_TAIL_HASH_BYTES,
					HEAD_TAIL_HASH_BYTES,
				)
			: TAIL_NOT_NEEDED;
	return `${stats.size}-${stats.mtimeNs}-${stats.ctimeNs}-${headHex}-${tailHex}`;
}

/**
 * SHA-256 the requested byte range of a file via a single read stream.
 * Truncated to 16 hex chars (64 bits) because the digest only needs to
 * disambiguate within a `(size, mtime, ctime)` bucket — full 256-bit
 * fingerprints would only waste filesystem path budget.
 * @param filePath - Absolute path to the file.
 * @param start - Inclusive byte offset to begin reading at.
 * @param length - Number of bytes to read; 0 returns the empty-input digest.
 * @returns A 16-character hex string.
 */
async function sha256OfRange(
	filePath: string,
	start: number,
	length: number,
): Promise<string> {
	const hash = createHash('sha256');
	if (length === 0) {
		return hash.digest('hex').slice(0, 16);
	}
	await new Promise<void>((resolve, reject) => {
		const stream = createReadStream(filePath, {
			start,
			end: start + length - 1,
		});
		stream.on('data', (chunk) => hash.update(chunk));
		stream.on('end', () => resolve());
		stream.on('error', (error) => reject(error));
	});
	return hash.digest('hex').slice(0, 16);
}
