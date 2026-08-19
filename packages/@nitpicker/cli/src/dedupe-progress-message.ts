/**
 * Wraps a message sink so consecutive identical messages are dropped —
 * shared by every `TaskList` row that feeds raw, per-chunk byte/count
 * callbacks (fired every ~64 KB or so) straight into `ctx.progress()`
 * (`create-setup-task-list.ts`'s `reportBytes`, `viewer-build.ts`'s backup/
 * extract/write steps). Without this, a multi-GB archive re-renders the row
 * thousands of times for byte deltas too small to change the rounded MB/%
 * text — the exact terminal-flooding regression issue #294 fixed for the
 * `Lanes`-based reporters (`createByteProgressLogger`/`createCountProgressLogger`)
 * by deduplicating on the rendered string, reproduced here for `TaskList`
 * call sites that bypass those wrappers (no label/animation prefix to add).
 * @param onMessage - Called only when the message differs from the last one.
 * @returns A `(message: string) => void` sink with the same signature.
 * @example
 * ```ts
 * const reportBytes = dedupeProgressMessage((message) => ctx.progress(message));
 * ```
 */
export function dedupeProgressMessage(
	onMessage: (message: string) => void,
): (message: string) => void {
	let lastMessage = '';
	return (message) => {
		if (message === lastMessage) {
			return;
		}
		lastMessage = message;
		onMessage(message);
	};
}
