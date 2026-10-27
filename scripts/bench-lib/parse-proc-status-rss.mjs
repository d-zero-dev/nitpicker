/**
 * Parses the resident-set lines of Linux's `/proc/self/status` into the same
 * shape {@link parseVmmapSummary} gives on macOS: the whole resident set as
 * the footprint, and its split into anonymous memory (`RssAnon`: the heap,
 * SQLite's page cache, `malloc`ed buffers), file-backed pages (`RssFile`: the
 * database file mapped by `PRAGMA mmap_size`, shared libraries) and shared
 * memory (`RssShmem`: the WAL index `-shm` file). Values are `kB` in the file.
 * @param {string} text - The `/proc/self/status` contents.
 * @returns {{
 *   physicalFootprintBytes: number | null;
 *   regions: Record<string, { residentBytes: number }>;
 * }} `VmRSS` as the footprint (`null` when absent) and the three `Rss*`
 *   fields that are present, in bytes.
 * @example
 * parseProcStatusRss(readFileSync('/proc/self/status', 'utf8')).regions.RssAnon.residentBytes;
 */
export function parseProcStatusRss(text) {
	const regions = {};
	for (const field of ['RssAnon', 'RssFile', 'RssShmem']) {
		const kib = readKib(text, field);
		if (kib !== null) {
			regions[field] = { residentBytes: kib * 1024 };
		}
	}
	const rss = readKib(text, 'VmRSS');
	return {
		physicalFootprintBytes: rss === null ? null : rss * 1024,
		regions,
	};
}

/**
 * Reads one `Field:   123 kB` line.
 * @param {string} text - The status file.
 * @param {string} field - The field name.
 * @returns {number | null} The value in KiB, or `null` when the line is absent.
 */
function readKib(text, field) {
	const match = new RegExp(`^${field}:\\s+(\\d+) kB$`, 'm').exec(text);
	return match ? Number(match[1]) : null;
}
