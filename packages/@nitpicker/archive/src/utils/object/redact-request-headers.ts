/** Placeholder shown instead of a request header value. */
const REDACTED = '***';

/**
 * Returns a copy of `config` whose `requestHeaders` values are replaced with
 * `***`, leaving the header names visible. Use it before a config object is
 * logged or printed.
 *
 * WHY: request header values are credentials. The runtime config that flows
 * through the orchestrator carries them, and it is dumped by `debug` logs and
 * the crawl-start header — neither may show a token.
 * @param config - Any config object that may carry `requestHeaders`.
 * @returns The same object when it has no `requestHeaders`, otherwise a shallow copy with masked values.
 * @example
 * redactRequestHeaders({ userAgent: 'x', requestHeaders: { Authorization: 'Bearer t' } });
 * // => { userAgent: 'x', requestHeaders: { Authorization: '***' } }
 */
export function redactRequestHeaders<T extends object>(config: T): T {
	const { requestHeaders } = config as {
		requestHeaders?: Readonly<Record<string, string>>;
	};
	if (!requestHeaders) {
		return config;
	}
	const masked: Record<string, string> = {};
	for (const name of Object.keys(requestHeaders)) {
		masked[name] = REDACTED;
	}
	return { ...config, requestHeaders: masked };
}
