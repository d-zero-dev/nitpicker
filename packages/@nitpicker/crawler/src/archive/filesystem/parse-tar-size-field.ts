/**
 * Parses a tar header's size field (offset 124, 12 bytes), which is either
 * a NUL/space-terminated octal ASCII string (standard) or, when the
 * high bit of the first byte is set, a GNU base-256 big-endian binary
 * encoding (used for sizes too large for the 11-digit octal field).
 * @param field - The 12-byte size field.
 * @returns The size in bytes, or `null` if the field cannot be parsed.
 * @example
 * ```ts
 * parseTarSizeField(Buffer.from('00000000004\0', 'latin1')); // 4
 * ```
 */
export function parseTarSizeField(field: Buffer): number | null {
	const first = field[0];
	if (first === undefined) {
		return null;
	}
	if ((first & 0x80) !== 0) {
		// GNU base-256: the remaining bits of the first byte plus all
		// following bytes form a big-endian unsigned integer. `.nitpicker`
		// tars never approach sizes needing this (single-digit-terabyte
		// range before it would even matter), but a correct read here still
		// costs nothing.
		// `0b0111_1111` (not `0x7F`) to sidestep the Prettier/eslint hex-case
		// conflict (Prettier always lowercases hex digits; this repo's
		// `unicorn/number-literal-case` requires uppercase) — a binary literal
		// has no letter digits to disagree about.
		let value = BigInt(first & 0b0111_1111);
		for (let i = 1; i < field.length; i++) {
			value = (value << 8n) | BigInt(field[i] ?? 0);
		}
		return Number(value);
	}
	const text = field.toString('latin1').replaceAll('\0', ' ').trim();
	if (text === '') {
		return 0;
	}
	const parsed = Number.parseInt(text, 8);
	return Number.isNaN(parsed) ? null : parsed;
}
