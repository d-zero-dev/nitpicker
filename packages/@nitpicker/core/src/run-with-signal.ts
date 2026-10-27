import type { NativeCancelToken } from './types.js';

import { nativeBinding } from './native-binding.js';

/**
 * Whether a native call rejected because its cancel token was raised.
 * @param error - What the call rejected with.
 */
function isCancelled(error: unknown): boolean {
	return error instanceof Error && (error as { code?: unknown }).code === 'Cancelled';
}

/**
 * Runs one asynchronous native call so an `AbortSignal` can stop it.
 *
 * With no signal, `run` gets no token and nothing is allocated. With one, a
 * fresh native token is raised when the signal fires, and the call stops at
 * its next check (between snapshots, between mebibytes of a snapshot's
 * decompression, or when it leaves the queue) and rejects
 * with code `Cancelled`; that rejection, and only that one, is replaced by
 * the signal's reason, so an abort reads as the caller's own abort. The
 * addon reports a cancellation over a decode failure of the same batch (the
 * caller asked to stop); a batch whose failure came before any snapshot saw
 * the abort still rejects with that failure, which is passed on unchanged.
 * A signal that is already aborted rejects with its reason without calling
 * the addon.
 * @param signal - The caller's signal, if any.
 * @param run - Starts the native call, passing the token as its last argument.
 * @returns What `run` resolved with.
 * @throws {unknown} The signal's reason when the signal aborted before or during the call.
 * @example
 * ```ts
 * const flags = await runWithSignal(signal, (token) =>
 * 	nativeBinding.matchSelectorSnapshots(plan, bodies, offsets, codecs, maxDecodedBytes, token),
 * );
 * ```
 */
export async function runWithSignal<T>(
	signal: AbortSignal | undefined,
	run: (token?: NativeCancelToken) => Promise<T>,
): Promise<T> {
	if (!signal) {
		return run();
	}
	signal.throwIfAborted();
	const token = new nativeBinding.NativeCancelToken();
	const onAbort = () => token.cancel();
	signal.addEventListener('abort', onAbort, { once: true });
	try {
		return await run(token);
	} catch (error) {
		if (signal.aborted && isCancelled(error)) {
			throw signal.reason;
		}
		throw error;
	} finally {
		signal.removeEventListener('abort', onAbort);
	}
}
