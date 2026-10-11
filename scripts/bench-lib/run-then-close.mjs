/* eslint-disable no-console */

/**
 * Runs `work`, then `close` — whichever way `work` ends. When both fail,
 * `work`'s error is the one rethrown (it is the cause; a failed cleanup
 * after it is usually a consequence) and the cleanup error is printed to
 * stderr instead of replacing it, as a bare `finally { await close() }`
 * would.
 * @template T
 * @param {() => Promise<T>} work - The work that owns the resource.
 * @param {() => Promise<void>} close - Releases the resource.
 * @returns {Promise<T>} What `work` resolved to.
 * @example
 * await runThenClose(
 *   () => searchHtml(accessor, options),
 *   () => manager.close(archiveId),
 * );
 */
export async function runThenClose(work, close) {
	let value;
	try {
		value = await work();
	} catch (error) {
		try {
			await close();
		} catch (closeError) {
			console.error('cleanup after a failure also failed:', closeError);
		}
		throw error;
	}
	await close();
	return value;
}
