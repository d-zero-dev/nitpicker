const MASK = '***';

/**
 * Returns a copy of the parsed `crawl` flags that is safe to print or log:
 * every request-header value is replaced with `***`, leaving the names.
 *
 * WHY: `--header` / `--authorization` / the resolved `requestHeaders` carry
 * credentials, and the flag object is dumped by the `DEBUG` log. `headerFile`
 * is a path, not a secret, so it is kept.
 * @param flags - Parsed `crawl` flags (any shape; only the header keys are touched).
 * @returns A shallow copy with the header values masked.
 * @example
 * maskHeaderFlags({ header: ['X-Api-Key: k'], authorization: 'Bearer t' });
 * // => { header: ['X-Api-Key: ***'], authorization: '***' }
 */
export function maskHeaderFlags<
	T extends {
		readonly header?: readonly string[] | undefined;
		readonly authorization?: string | undefined;
		readonly requestHeaders?: Readonly<Record<string, string>> | undefined;
	},
>(flags: T): T {
	const masked: Record<string, unknown> = { ...flags };
	if (flags.header) {
		masked.header = flags.header.map((line) => {
			const colon = line.indexOf(':');
			return colon > 0 ? `${line.slice(0, colon).trim()}: ${MASK}` : MASK;
		});
	}
	if (flags.authorization !== undefined) {
		masked.authorization = MASK;
	}
	if (flags.requestHeaders) {
		masked.requestHeaders = Object.fromEntries(
			Object.keys(flags.requestHeaders).map((name) => [name, MASK]),
		);
	}
	return masked as T;
}
