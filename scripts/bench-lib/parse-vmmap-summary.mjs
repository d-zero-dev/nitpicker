/**
 * Parses the text `vmmap --summary <pid>` prints on macOS into the process's
 * physical footprint and the per-region-type table (virtual, resident and
 * dirty bytes). The region types are what tells SQLite's page cache and
 * `malloc`ed buffers (`MALLOC_*`) apart from the database file the kernel
 * mapped in (`mapped file`, from `PRAGMA mmap_size`) and from WAL shared
 * memory (`shared memory`, the `-shm` file) — the process RSS alone cannot.
 *
 * Only the first table (`REGION TYPE` … `TOTAL`) is read; the malloc zone
 * table that follows is skipped. Sizes in the table carry a `K` / `M` / `G` /
 * `T` suffix (1024-based; `T` appears for the large virtual ranges V8
 * reserves) or none (bytes).
 * @param {string} text - The `vmmap --summary` output.
 * @returns {{
 *   physicalFootprintBytes: number | null;
 *   regions: Record<string, { virtualBytes: number; residentBytes: number; dirtyBytes: number }>;
 * }} The footprint (`null` when the line is absent) and region type → sizes.
 * @example
 * const { physicalFootprintBytes, regions } = parseVmmapSummary(
 *   execFileSync('vmmap', ['--summary', String(process.pid)], { encoding: 'utf8' }),
 * );
 * regions['MALLOC_LARGE'].residentBytes;
 */
export function parseVmmapSummary(text) {
	const footprintMatch = /^Physical footprint:\s+(\S+)$/m.exec(text);
	const physicalFootprintBytes = footprintMatch
		? parseSizeToken(footprintMatch[1])
		: null;

	const regions = {};
	let inTable = false;
	for (const line of text.split('\n')) {
		if (line.startsWith('===========')) {
			// The first rule opens the region table, the second closes it.
			if (inTable) {
				break;
			}
			inTable = true;
			continue;
		}
		if (!inTable) {
			continue;
		}
		const row = parseRegionRow(line);
		if (row) {
			regions[row.name] = row.sizes;
		}
	}
	return { physicalFootprintBytes, regions };
}

const UNIT_BYTES = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
const SIZE_TOKEN = new RegExp(
	String.raw`^\d+(?:\.\d+)?[${Object.keys(UNIT_BYTES).join('')}]?$`,
);

/**
 * Turns `1.5G` / `256K` / `848` into bytes.
 * @param {string} token - The size as vmmap prints it.
 * @returns {number} Bytes.
 */
function parseSizeToken(token) {
	const unit = token.at(-1);
	if (unit in UNIT_BYTES) {
		return Number(token.slice(0, -1)) * UNIT_BYTES[unit];
	}
	return Number(token);
}

/**
 * Reads one region row. The name may contain spaces and parentheses, the
 * seven size columns and the region count follow it, and malloc rows end
 * with a note ("see MALLOC ZONE table below") that is dropped.
 * @param {string} line - One line inside the region table.
 * @returns {{ name: string; sizes: { virtualBytes: number; residentBytes: number; dirtyBytes: number } } | null}
 *   The row, or `null` for a line that is not a region row.
 */
function parseRegionRow(line) {
	const tokens = line.trim().split(/\s+/);
	const noteAt = tokens.indexOf('see');
	const columns = noteAt === -1 ? tokens : tokens.slice(0, noteAt);
	// 7 sizes + the region count.
	if (columns.length < 9) {
		return null;
	}
	const sizes = columns.slice(-8, -1);
	const count = columns.at(-1);
	if (!sizes.every((t) => SIZE_TOKEN.test(t)) || !/^\d+$/.test(count)) {
		return null;
	}
	// The `TOTAL` row sits after the closing rule, which ends the table above,
	// so it never reaches here and needs no case of its own.
	return {
		name: columns.slice(0, -8).join(' '),
		sizes: {
			virtualBytes: parseSizeToken(sizes[0]),
			residentBytes: parseSizeToken(sizes[1]),
			dirtyBytes: parseSizeToken(sizes[2]),
		},
	};
}
