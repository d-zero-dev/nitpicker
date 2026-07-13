import type { DecodedDataUri } from './types.js';

/**
 * Attempts to decode a `data:...` URI into its raw payload bytes.
 *
 * Supports the two encoding forms in RFC 2397:
 *
 * - `data:<mime>;base64,<base64-bytes>` — the base64 tail is decoded via
 *   `Buffer.from(..., 'base64')`.
 * - `data:<mime>,<percent-encoded-bytes>` — the tail is percent-decoded
 *   via `decodeURIComponent(...)`, then re-encoded as UTF-8. This form is
 *   commonly used for SVG data URIs.
 *
 * Returns `null` on any parse / decode failure so the caller can skip the
 * value without aborting the whole `blob_refs` population step. A single
 * malformed data URI in a 470 K-row archive should not halt the migration
 * — the raw `url` string is still preserved in the source `images` row.
 * @param value - Raw column value; may or may not start with `data:`.
 * @returns Decoded bytes, or `null` when the value isn't a data URI or
 *   can't be decoded.
 */
export function decodeDataUri(value: string): DecodedDataUri | null {
	if (!value.startsWith('data:')) {
		return null;
	}
	const commaIndex = value.indexOf(',');
	if (commaIndex === -1) {
		return null;
	}
	const header = value.slice(5, commaIndex);
	const payload = value.slice(commaIndex + 1);
	try {
		if (/;\s*base64$/i.test(header)) {
			// `Buffer.from(..., 'base64')` silently strips characters outside
			// the base64 alphabet — a malformed payload decodes to garbage
			// instead of throwing. Validate the alphabet + padding shape
			// first so callers can distinguish "successfully decoded" from
			// "silently corrupted" and get the promised `null` on malformed
			// input.
			if (!isValidBase64(payload)) {
				return null;
			}
			const bytes = Buffer.from(payload, 'base64');
			return { bytes };
		}
		return { bytes: percentDecodeToBytes(payload) };
	} catch {
		return null;
	}
}

/**
 * Standard base64 alphabet + padding, plus one common URL-safe variant
 * that occasionally appears in `data:` URIs even though RFC 2397 says
 * only the standard alphabet. `-` / `_` are the URL-safe substitutes
 * for `+` / `/`.
 */
const BASE64_ALPHABET_RE = /^[\w+/-]*={0,2}$/;

/**
 * Validates whether a base64 payload is well-formed enough that
 * `Buffer.from(payload, 'base64')` won't need to silently strip
 * characters. Whitespace-tolerant (RFC 2045 permits internal
 * whitespace in base64 line-wrapped output).
 * @param payload - Base64 payload (everything after `,` in the data URI).
 * @returns `true` when the payload contains only valid base64 characters
 *   + optional trailing padding.
 */
function isValidBase64(payload: string): boolean {
	const stripped = payload.replaceAll(/\s+/g, '');
	if (stripped === '') {
		return true;
	}
	if (!BASE64_ALPHABET_RE.test(stripped)) {
		return false;
	}
	// base64 chunks group by 4 characters — a well-formed payload has
	// length ≡ 0 (mod 4) once padding is applied. Padding-less trailing
	// chunks of length 2 or 3 are also accepted (Node's decoder tolerates
	// missing `=`), but length 1 or a padding-only chunk is malformed.
	const remainder = stripped.length % 4;
	if (remainder === 1) {
		return false;
	}
	return true;
}

/**
 * Percent-decodes a data-URI payload byte-by-byte, avoiding the round
 * through `decodeURIComponent` → UTF-8 re-encode that mangles arbitrary
 * binary payloads (e.g. a `%FF` byte becomes a JS string of code
 * point U+00FF, then re-encodes to `[0xC3, 0xBF]` — the byte value
 * changes). RFC 2397's non-base64 form treats the payload as octets,
 * not as a UTF-8 string, so an octet-preserving decode is the correct
 * inverse.
 * @param payload - Raw payload text (everything after the `,`).
 * @returns Payload bytes.
 * @throws {URIError} If a `%` escape is malformed (via `URIError`
 *   propagation from `Buffer.from(hex, 'hex')`); caller catches.
 */
function percentDecodeToBytes(payload: string): Buffer {
	const chunks: Buffer[] = [];
	let i = 0;
	while (i < payload.length) {
		const ch = payload.codePointAt(i)!;
		if (ch === 0x25 /* % */) {
			if (i + 2 >= payload.length) {
				throw new URIError('truncated % escape');
			}
			const hex = payload.slice(i + 1, i + 3);
			if (!/^[\da-f]{2}$/i.test(hex)) {
				throw new URIError('invalid % escape');
			}
			chunks.push(Buffer.from(hex, 'hex'));
			i += 3;
			continue;
		}
		if (ch > 127 /* 0x7F, ASCII high-bit boundary */) {
			// A non-ASCII code point in a percent-encoded payload is
			// unusual (browsers percent-encode outbound), but WHATWG
			// tolerates it — encode as UTF-8 to preserve the character.
			chunks.push(Buffer.from(payload[i]!, 'utf8'));
			i += 1;
			continue;
		}
		chunks.push(Buffer.from([ch]));
		i += 1;
	}
	return Buffer.concat(chunks);
}
