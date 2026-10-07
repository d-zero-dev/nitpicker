/**
 * Escapes a string so it matches itself literally inside a regular
 * expression source.
 * @param text - The literal text.
 * @returns The escaped source fragment.
 * @example
 * escapeRegExpSource('a.b'); // 'a\\.b'
 */
export function escapeRegExpSource(text: string): string {
	return text.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}
