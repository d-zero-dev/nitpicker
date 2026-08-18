/**
 * Wraps `stream` so every `write()` call is prefixed with an ISO 8601
 * timestamp — the `TaskList` equivalent of `formatLogLine`'s verbose
 * timestamping for the `Lanes`-based progress reporters (issue #294): a
 * `--verbose` run appends one line per state transition instead of
 * overwriting a single line, so the timestamp is the only record of how
 * long each step took.
 *
 * `TaskList.run()`'s `Lanes`/`Display` internals call `stream.write()` once
 * per already-newline-terminated line in verbose mode (one call per
 * `pending`/`running`/`done`/`error` transition and per `ctx.progress()`
 * update) — wrapping the stream itself, rather than each `ctx.progress()`
 * message, catches every line dealer renders, including the state
 * transitions the CLI never composes a message string for itself.
 *
 * Only `write()` is intercepted; every other property (`on`/`off` for
 * `Display`'s resize listener, etc.) is forwarded untouched via `Reflect`.
 * @param stream - The stream to wrap (`process.stderr` in this CLI).
 * @returns A stream with the same interface as `stream`, sharing its
 *   identity for every operation except `write()`.
 * @example
 * ```ts
 * await pipeline.run({ stream: createVerboseTimestampStream(process.stderr), verbose: true });
 * // "2026-08-18T00:00:00.000Z ✔ Extracting archive (1.2s)"
 * ```
 */
export function createVerboseTimestampStream(
	stream: NodeJS.WritableStream,
): NodeJS.WritableStream {
	return new Proxy(stream, {
		get(target, property, receiver) {
			if (property === 'write') {
				const write = target.write.bind(target) as (...args: unknown[]) => boolean;
				return (chunk: unknown, ...rest: unknown[]) => {
					const text = typeof chunk === 'string' ? chunk : String(chunk);
					return write(`${new Date().toISOString()} ${text}`, ...rest);
				};
			}
			return Reflect.get(target, property, receiver);
		},
	});
}
