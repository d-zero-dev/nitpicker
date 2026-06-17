import { list } from 'tar';

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
 * Reads the tar's central directory only; does not extract any data. Runs
 * in O(number of entries) but stops at the first match, so a typical
 * archive (1–2 top-level entries) completes in a single read.
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
			// `entry.path` is the path inside the tar. Strip any leading
			// `./` (some tar producers prepend it) before splitting.
			const cleaned = entry.path.replace(/^\.\//, '');
			const top = cleaned.split('/')[0];
			if (!top || top === '') return;
			// Defense in depth: skip AppleDouble directory entries
			// (`._foo/`) and pax extended header entries
			// (`PaxHeaders.NNN/...` / `@PaxHeader`). Real `.nitpicker`
			// archives never name their top dir with these prefixes.
			if (top.startsWith('._')) return;
			if (top.startsWith('PaxHeaders') || top.startsWith('@PaxHeader')) return;
			found = top;
		},
	});
	if (found === null) {
		throw new Error(`Tar contains no top-level directory entry: ${tarFilePath}`);
	}
	return found;
}
