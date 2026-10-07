import type { ParsedHeader } from './types.js';

/** RFC 7230 `token` — the only characters a header field name may contain. */
const TOKEN_PATTERN = /^[\w!#$%&'*+.^`|~-]+$/;

/** Horizontal tab — the one control character an HTTP header value may contain. */
const TAB_CODE = 9;
/** First printable ASCII code point (SPACE). */
const FIRST_PRINTABLE = 32;
/** DEL — the one non-printable character above the ASCII control block. */
const DEL = 127;
/** Highest code point of Latin-1, the upper bound of what Node's HTTP client sends. */
const LATIN1_MAX = 255;

/**
 * Whether `value` holds a character Node's HTTP client (`checkInvalidHeaderChar`)
 * or Chromium would refuse: control characters other than horizontal tab (CR/LF/NUL —
 * header injection — included), DEL, and anything above U+00FF. Such a value
 * would make every request throw `ERR_INVALID_CHAR` later, so it is rejected up
 * front where the operator can still fix the flag.
 * @param value - The header value to check.
 * @returns `true` when the value contains a disallowed character.
 */
function hasDisallowedValueChar(value: string): boolean {
	for (const char of value) {
		const code = char.codePointAt(0)!;
		if (code === TAB_CODE) {
			continue;
		}
		if (code < FIRST_PRINTABLE || code === DEL || code > LATIN1_MAX) {
			return true;
		}
	}
	return false;
}

/**
 * Header names the crawler owns or that would corrupt the request framing.
 * `User-Agent` has its own flag so the value also reaches the browser and the
 * archive config.
 */
const RESERVED_NAMES: ReadonlyMap<string, string> = new Map([
	['host', 'it is derived from the URL'],
	['content-length', 'it would corrupt the request framing'],
	['transfer-encoding', 'it would corrupt the request framing'],
	['connection', 'it is managed by the HTTP client'],
	['user-agent', 'use --user-agent instead'],
]);

/**
 * Parses one `Name: value` line (curl `-H` style) into a request header.
 *
 * Splits at the first `:` only, so values may themselves contain colons
 * (`X-Callback: https://example.com/hook`, timestamps, `user:pass` tokens).
 *
 * Rejected: a missing `:`, a name that is not an RFC 7230 token, a reserved
 * name, an empty value, and a value with characters HTTP does not allow
 * (CR/LF/NUL, other control characters, anything above U+00FF).
 *
 * Error messages never echo the line's content: it is usually a credential,
 * and a mistyped line (`X-Token=abc:def`, `Authorization Bearer abc`) puts
 * part of the secret in the "name" position. Only a reserved name — matched
 * against a fixed list, so it cannot carry a secret — is printed.
 * @param line - The raw `Name: value` text.
 * @returns The parsed name and trimmed value.
 * @throws {Error} When the line is not a valid, permitted header.
 * @example
 * parseHeaderLine('Authorization: Bearer abc');
 * // => { name: 'Authorization', value: 'Bearer abc' }
 */
export function parseHeaderLine(line: string): ParsedHeader {
	const colon = line.indexOf(':');
	if (colon <= 0) {
		throw new Error('Invalid header: expected "Name: value".');
	}
	const name = line.slice(0, colon).trim();
	const value = line.slice(colon + 1).trim();
	if (!TOKEN_PATTERN.test(name)) {
		throw new Error('Invalid header name: expected an RFC 7230 token before the ":".');
	}
	const reservedReason = RESERVED_NAMES.get(name.toLowerCase());
	if (reservedReason) {
		throw new Error(`Header "${name}" cannot be set: ${reservedReason}.`);
	}
	if (value === '') {
		throw new Error('Invalid header: the value must not be empty.');
	}
	if (hasDisallowedValueChar(value)) {
		throw new Error(
			'Invalid header: the value contains characters HTTP does not allow (line breaks, control characters, or code points above U+00FF).',
		);
	}
	return { name, value };
}
