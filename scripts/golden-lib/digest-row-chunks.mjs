import { createHash } from 'node:crypto';

/**
 * `JSON.stringify` replacer that keeps values JSON cannot represent apart: a
 * `BigInt` would throw, `NaN` and the infinities would all become `null` (so a
 * change from `NaN` to `null` would go unnoticed), and a `Buffer` would hash as
 * a list of numbers. Plain values (strings, finite numbers, `null`, booleans)
 * are left untouched, so the digest of an ordinary row is its JSON line.
 * @this {Record<string, unknown>}
 * @param {string} key - The property being serialized.
 * @param {unknown} value - Its value after `toJSON`.
 * @returns {unknown} The value to serialize.
 */
function tagNonJsonValues(key, value) {
	const raw = this[key];
	if (typeof raw === 'bigint') {
		return { $bigint: raw.toString() };
	}
	if (typeof raw === 'number' && !Number.isFinite(raw)) {
		return { $number: String(raw) };
	}
	if (raw instanceof Uint8Array) {
		return { $bytes: Buffer.from(raw).toString('hex') };
	}
	return value;
}

/**
 * Summarizes a table's rows, in the order given, as a row count plus one
 * SHA-256 per run of `chunkSize` rows. A golden dump keeps this instead of
 * the rows because a table can hold millions of rows with crawled URLs in
 * them: the digests are small, carry no URL, and a mismatch still names the
 * row range that changed.
 *
 * Each row is hashed as its JSON line (`JSON.stringify`, with values JSON
 * cannot represent tagged so they stay distinct), so the digest depends on
 * column order, values and row order.
 * @param {Iterable<Record<string, unknown>> | AsyncIterable<Record<string, unknown>>} rows - The rows, in table order.
 * @param {number} chunkSize - Rows per digest.
 * @returns {Promise<Map<string, string>>} `rows` → the count, then
 *   `chunk:<index of its first row>` → the digest, one per chunk.
 * @throws {RangeError} When `chunkSize` is not a positive integer.
 * @example
 * const entries = await digestRowChunks([{ a: 1 }, { a: 2 }, { a: 3 }], 2);
 * // Map { 'rows' => '3', 'chunk:0' => '…', 'chunk:2' => '…' }
 */
export async function digestRowChunks(rows, chunkSize) {
	if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
		throw new RangeError(`chunkSize must be a positive integer, got ${chunkSize}`);
	}
	const chunks = [];
	let hash;
	let rowCount = 0;
	for await (const row of rows) {
		if (rowCount % chunkSize === 0) {
			hash = createHash('sha256');
			chunks.push({ start: rowCount, hash });
		}
		hash.update(`${JSON.stringify(row, tagNonJsonValues)}\n`);
		rowCount += 1;
	}
	const entries = new Map([['rows', String(rowCount)]]);
	for (const chunk of chunks) {
		entries.set(`chunk:${chunk.start}`, chunk.hash.digest('hex'));
	}
	return entries;
}
