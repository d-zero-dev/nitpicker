/**
 * Wraps a message sink so consecutive identical messages are dropped —
 * every `TaskList` row in `create-sheets.ts` feeds a per-row onProgress
 * callback (fired every row in the underlying stream) straight into
 * `ctx.progress()`; without this, a million-row sheet re-renders the row
 * thousands of times for count deltas too small to change the rendered
 * percentage text. Mirrors `@nitpicker/cli`'s `dedupe-progress-message.ts`;
 * duplicated here rather than imported because `report-google-sheets`
 * cannot depend on `cli` (the dependency direction is reversed).
 * @param onMessage - Called only when the message differs from the last one.
 * @returns A `(message: string) => void` sink with the same signature.
 * @example
 * ```ts
 * const reportProgress = dedupeProgressMessage((message) => ctx.progress(message));
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
