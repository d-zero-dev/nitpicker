import type { FileHandle } from 'node:fs/promises';

import { open } from 'node:fs/promises';

import { list } from 'tar';

import { parsePaxPath } from './parse-pax-path.js';
import { parseTarSizeField } from './parse-tar-size-field.js';

/** Bytes per tar header/data block (fixed by the tar format). */
const BLOCK_SIZE = 512;

/** Defensive cap on entries scanned before giving up and falling back to `list()`. */
const MAX_ENTRIES = 100_000;

/** Cap on PAX/GNU-longname payload size read into memory; larger is treated as malformed. */
const MAX_EXTENDED_PAYLOAD_SIZE = 1_000_000;

/**
 * Reads the top-level directory name from a `.nitpicker` tar archive.
 *
 * Why: a `.nitpicker` is a tar that wraps `<basename>/db.sqlite` (and
 * historically other files). `Archive.write()` names the inner directory
 * from the file's basename at write time, but users routinely rename
 * `.nitpicker` files after the fact (e.g. `mv X.migrated.nitpicker
 * X.nitpicker`) — a perfectly reasonable filesystem operation that breaks
 * any code that recomputes the inner-dir name from the outer filename.
 *
 * This helper scans the tar's entry list and returns the first top-level
 * directory it sees, so callers (`Archive.open`, the migration script) can
 * use the actual inner name regardless of what the outer file is called.
 *
 * Parses raw tar headers directly (ustar fixed fields, PAX extended headers,
 * GNU longname/longlink) instead of using the `tar` package's `list()` —
 * `list()` reads the entire archive stream to completion even after
 * `onReadEntry` has found what it needs (no internal early-abort), so on a
 * 15 GB+ archive it was a second full read on top of `untar()`'s own read
 * (issue #294). The fast path here stops at the first top-level directory
 * entry, typically reading well under 1 KB. Falls back to the original
 * `list()`-based scan on anything it doesn't recognize (unknown typeflag
 * sequence, truncated read, non-tar content) — safety over speed for
 * archives this function has never been exercised against.
 * @param tarFilePath - Path to the `.nitpicker` tar file.
 * @returns The first top-level directory name found in the archive.
 * @throws {Error} When the tar contains no top-level directory entry
 *   (e.g. file is empty, corrupted, or non-tar). The error message
 *   identifies the path for diagnostics.
 * @example
 * // The user renamed `original.nitpicker` to `renamed.nitpicker`. The
 * // inner directory was baked in at write time and is unaffected:
 * await peekTarTopDir('renamed.nitpicker'); // → 'original'
 */
export async function peekTarTopDir(tarFilePath: string): Promise<string> {
	const fast = await peekTarTopDirFast(tarFilePath);
	if (fast !== null) {
		return fast;
	}
	return await peekTarTopDirViaList(tarFilePath);
}

/**
 * Returns `true` for a top-level directory name that should be skipped: an
 * AppleDouble resource-fork sidecar (`._foo`, from macOS BSD tar) or a PAX
 * header directory (`PaxHeaders.NNN`/`@PaxHeader`). Real `.nitpicker`
 * archives never name their actual top dir with these prefixes. Shared by
 * both the fast path and the `list()` fallback so the two can't drift into
 * accepting different names for the same archive.
 * @param name - Candidate top-level directory name.
 */
function isSkippableTopDirName(name: string): boolean {
	return (
		name.startsWith('._') ||
		name.startsWith('PaxHeaders') ||
		name.startsWith('@PaxHeader')
	);
}

/**
 * Extracts the first path segment from a tar entry path, after stripping a
 * leading `./` some tar producers prepend.
 * @param entryPath - The raw path recorded in (or resolved for) a tar entry.
 */
function topSegmentOf(entryPath: string): string {
	return entryPath.replace(/^\.\//, '').split('/')[0] ?? '';
}

/**
 * Reads a NUL-terminated (or full-width, if no NUL) string field out of a
 * tar header block.
 * @param header - The 512-byte header block.
 * @param start - Field start offset.
 * @param length - Field length in bytes.
 */
function readHeaderString(header: Buffer, start: number, length: number): string {
	const field = header.subarray(start, start + length);
	const nulIndex = field.indexOf(0);
	const raw = nulIndex === -1 ? field : field.subarray(0, nulIndex);
	return raw.toString('utf8');
}

/**
 * Fast path for {@link peekTarTopDir}: reads raw 512-byte tar header blocks
 * directly from the file, stopping at the first top-level directory entry.
 * Understands ustar fixed headers, PAX extended headers (`path=`, the form
 * `tar`/node-tar emits for UTF-8 or >100-byte names — verified empirically:
 * see this function's test fixtures), and GNU longname (`typeflag 'L'`,
 * treated the same as a PAX path override for the next entry — this
 * codebase's own `tar()` never emits it, but a `.nitpicker` produced by a
 * different tar implementation should still resolve correctly). GNU
 * longlink (`typeflag 'K'`, a symlink target — irrelevant to a directory
 * name lookup) is skipped without being applied to anything.
 *
 * Returns `null` — never throws — on anything unrecognized: truncated read,
 * unparseable size field, entry count past {@link MAX_ENTRIES}, or reaching
 * the end-of-archive marker without finding a directory. The caller falls
 * back to the exhaustive `list()`-based scan in every `null` case.
 * @param tarFilePath - Path to the `.nitpicker` tar file.
 * @returns The first top-level directory name, or `null` to fall back.
 */
async function peekTarTopDirFast(tarFilePath: string): Promise<string | null> {
	let fileHandle: FileHandle | undefined;
	try {
		fileHandle = await open(tarFilePath, 'r');
		const header = Buffer.alloc(BLOCK_SIZE);
		let position = 0;
		// Set by a preceding PAX ('x') or GNU longname ('L') entry; applies
		// to the very next entry only, then is cleared.
		let pendingPath: string | null = null;

		for (let entryIndex = 0; entryIndex < MAX_ENTRIES; entryIndex++) {
			const { bytesRead } = await fileHandle.read(header, 0, BLOCK_SIZE, position);
			if (bytesRead < BLOCK_SIZE) {
				return null;
			}
			position += BLOCK_SIZE;

			if (header.every((byte) => byte === 0)) {
				// End-of-archive marker reached with no directory found —
				// genuinely absent, not a parse failure, but the caller's
				// error message is clearer coming from the exhaustive path.
				return null;
			}

			const typeflag = String.fromCodePoint(header[156] ?? 0);
			const size = parseTarSizeField(header.subarray(124, 136));
			if (size === null) {
				return null;
			}
			const dataBlockCount = Math.ceil(size / BLOCK_SIZE);
			const dataStart = position;
			position += dataBlockCount * BLOCK_SIZE;

			if (typeflag === 'x' || typeflag === 'L') {
				if (size <= 0 || size > MAX_EXTENDED_PAYLOAD_SIZE) {
					return null;
				}
				const payload = Buffer.alloc(size);
				const { bytesRead: payloadBytesRead } = await fileHandle.read(
					payload,
					0,
					size,
					dataStart,
				);
				if (payloadBytesRead !== size) {
					return null;
				}
				pendingPath =
					typeflag === 'x'
						? parsePaxPath(payload)
						: payload.toString('utf8').replace(/\0.*$/, '');
				continue;
			}
			if (typeflag === 'g' || typeflag === 'K') {
				// PAX global header (applies archive-wide, never carries a
				// per-entry path) / GNU longlink (symlink target, irrelevant
				// to a directory name lookup) — skip without consuming
				// `pendingPath`.
				continue;
			}

			const magic = header.toString('latin1', 257, 263);
			const nameField = readHeaderString(header, 0, 100);
			const prefixField = magic.startsWith('ustar')
				? readHeaderString(header, 345, 155)
				: '';
			const entryPath =
				pendingPath ?? (prefixField ? `${prefixField}/${nameField}` : nameField);
			pendingPath = null;

			if (typeflag === '5') {
				const top = topSegmentOf(entryPath);
				if (top && !isSkippableTopDirName(top)) {
					return top;
				}
			}
		}
		return null;
	} catch {
		return null;
	} finally {
		await fileHandle?.close();
	}
}

/**
 * Exhaustive fallback for {@link peekTarTopDir}: scans the tar's entry list
 * via the `tar` package. Reads the archive to completion regardless of when
 * a match is found (no early-abort in the `tar` package's `list()` API),
 * which is exactly the cost {@link peekTarTopDirFast} exists to avoid — this
 * path only runs when the fast path can't make sense of the header stream.
 * @param tarFilePath - Path to the `.nitpicker` tar file.
 * @returns The first top-level directory name found in the archive.
 * @throws {Error} When the tar contains no top-level directory entry.
 */
async function peekTarTopDirViaList(tarFilePath: string): Promise<string> {
	let found: string | null = null;
	await list({
		file: tarFilePath,
		onReadEntry: (entry) => {
			if (found !== null) return;
			// Only Directory entries count. Files at the tar root would
			// otherwise win — and macOS BSD tar embeds AppleDouble (`._*`)
			// sidecar files at the tar root for resource forks; those are
			// File entries that BSD `tar -tf` hides but Node's `tar`
			// surfaces verbatim, so without this filter the resource-fork
			// of the real top-level dir would win instead of the dir itself.
			if (entry.type !== 'Directory') return;
			const top = topSegmentOf(entry.path);
			if (!top || isSkippableTopDirName(top)) return;
			found = top;
		},
	});
	if (found === null) {
		throw new Error(`Tar contains no top-level directory entry: ${tarFilePath}`);
	}
	return found;
}
