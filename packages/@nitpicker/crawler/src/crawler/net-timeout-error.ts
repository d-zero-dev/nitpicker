/**
 * Error thrown when a network request (typically an HTTP HEAD check)
 * exceeds the allowed timeout duration. Used by `fetchDestination`
 * to signal that the destination server did not respond in time.
 */
export default class NetTimeoutError extends Error {
	constructor(url?: string) {
		super(url ? `Timeout: ${url}` : 'Timeout');
	}
	override name = 'NetTimeoutError';
}
