import type { CrawlConsoleHandle, CreateCrawlConsoleOptions } from './types.js';

/** Ctrl-C (`\x03`) — routed to `onInterrupt` instead of the terminal's own SIGINT, since raw mode disables the terminal's own Ctrl-C handling. */
const CTRL_C = '\u0003';
/** Ctrl-U (`\x15`) — conventional "clear the current input line" shortcut. */
const CTRL_U = '\u0015';
/** Escape (`\x1b`) alone (not followed by `[`) — treated as "clear the current input line". */
const ESC = '\u001B';
/** Backspace as sent by most terminals (DEL, `\x7f`). */
const DEL = '\u007F';
/** Backspace as sent by some terminals/emulators (BS, `\x08`). */
const BS = '\u0008';
/**
 * How long to wait for a continuation byte after a lone `ESC` (or an
 * incomplete `ESC '['` CSI sequence) before resolving it on a timeout —
 * matches the terminal-library convention (e.g. ncurses' `ESCDELAY`) for
 * this exact ambiguity: a bare Escape keypress and the first byte of a CSI
 * sequence are indistinguishable until either the next byte arrives or
 * enough time passes that no more are coming.
 */
const ESCAPE_TIMEOUT_MS = 50;

/** Hides the terminal's own text cursor (ANSI show/hide cursor sequence). */
const HIDE_CURSOR = `${ESC}[?25l`;
/** Restores the terminal's own text cursor (ANSI show/hide cursor sequence). */
const SHOW_CURSOR = `${ESC}[?25h`;

/**
 * Draws an always-visible input line as the crawl `Lanes`' footer and turns
 * raw keystrokes from `stdin` into submitted commands, Ink/Claude-Code-style
 * — an input box baked into the same redraw frame as the log lines above it,
 * rather than a separate readline prompt (which would fight `Lanes`/`Display`
 * for the terminal, see `ARCHITECTURE.md`'s single-Lanes-instance invariant).
 *
 * Enter submits the current buffer as one command (see
 * `parseCrawlConsoleCommand`) — commands run strictly one at a time; a line
 * submitted while a previous one's `onCommand` call is still pending queues
 * behind it ({@link pendingLines}) rather than starting a second, overlapping
 * call (possible from a single multi-line paste, which arrives as one `data`
 * chunk with more than one `\r`/`\n`). Backspace/Delete removes the last character;
 * Ctrl-U or a bare Escape clears the buffer; Ctrl-C calls `onInterrupt`
 * instead of being handled by the terminal (raw mode disables that). ANSI
 * CSI sequences (arrow keys, Delete-forward, Home/End, ...) are recognized
 * and discarded as a unit — this console has no cursor position to move
 * within a single-line buffer, and letting their raw bytes fall through to
 * the "printable character" branch would inject garbage like `[A` into the
 * buffer. Every other C0 control byte is ignored. A lone `ESC` and the first
 * byte of a CSI sequence are indistinguishable until the next byte arrives
 * (or a fragmented stdin read — SSH/tmux — splits a sequence across `data`
 * events); `escapeTimer`/`ESCAPE_TIMEOUT_MS` resolve the ambiguity after a
 * short wait instead of guessing wrong in either direction.
 *
 * The drawn `▌`/`…` glyph at the end of the input line is a synthetic
 * cursor, not the terminal's own — `Display#write()` always ends its frame
 * with a trailing `\n`, which leaves the real cursor sitting on the blank
 * line below whatever this function draws. Left alone, that reads as two
 * cursors at once, so this hides the real one (`HIDE_CURSOR`) for as long as
 * the console is active and restores it (`SHOW_CURSOR`) on `dispose()` —
 * the synthetic glyph is the only one ever visible.
 * @param options - See {@link CreateCrawlConsoleOptions}.
 * @returns A handle to restore stdin and clear the footer. Caller must call
 *   `dispose()` on every exit path (crawl finishes, fails, or is aborted) —
 *   `stdin` is left in raw mode and paused, and the terminal's cursor stays
 *   hidden, otherwise.
 * @example
 * ```ts
 * const console = createCrawlConsole({
 *   stdin: process.stdin,
 *   lanes,
 *   stream: process.stderr,
 *   initialStatus: formatCrawlConsoleHelp(),
 *   onCommand: async (line) => {
 *     const parsed = parseCrawlConsoleCommand(line);
 *     if (parsed.kind !== 'patch') return formatCrawlConsoleHelp();
 *     const snapshot = orchestrator.updateRuntimeOptions(parsed.patch);
 *     return formatCrawlConsoleResult(parsed.patch, snapshot);
 *   },
 *   onInterrupt: () => orchestrator.abort(),
 * });
 * // ...later, once the crawl settles...
 * console.dispose();
 * ```
 */
export function createCrawlConsole(
	options: CreateCrawlConsoleOptions,
): CrawlConsoleHandle {
	const { stdin, lanes, stream, onCommand, onInterrupt } = options;

	let buffer = '';
	let status = options.initialStatus ?? '';
	let running = false;
	let disposed = false;
	/**
	 * Lines submitted (Enter) while {@link running} is already `true` — a
	 * single `data` chunk can carry more than one `\r`/`\n` (a multi-line
	 * paste), and `handleData`'s loop processes all of them synchronously
	 * without waiting on `onCommand`. Queued here instead of starting a
	 * second, overlapping `onCommand(...)` call — {@link runCommand} drains
	 * this FIFO once the in-flight call resolves, so submitted commands
	 * always run one at a time, in submission order.
	 */
	const pendingLines: string[] = [];
	/**
	 * An `ESC`, or an `ESC '['` CSI sequence, that `handleData` couldn't yet
	 * classify because the chunk ended before the ambiguity resolved (a bare
	 * Escape keypress vs. the start of a CSI sequence, or a CSI sequence
	 * whose final byte hasn't arrived yet). Prefixed onto the next `data`
	 * chunk if one arrives before {@link escapeTimer} fires — a fragmented
	 * stdin read (SSH/tmux) can split a single keypress's bytes across
	 * multiple `data` events.
	 */
	let pendingEscape = '';
	/**
	 * Pending resolution for {@link pendingEscape}, started whenever it's set
	 * and cleared whenever more data arrives (handled) or `dispose()` runs.
	 * See {@link ESCAPE_TIMEOUT_MS}.
	 */
	let escapeTimer: ReturnType<typeof setTimeout> | null = null;

	const render = () => {
		const inputLine = `> ${buffer}${running ? ' …' : '▌'}`;
		lanes.footer(status ? `${status}\n${inputLine}` : inputLine);
	};

	/**
	 * Runs one command through `onCommand`, then either starts the next
	 * queued line ({@link pendingLines}) or clears {@link running} — never
	 * both concurrently, keeping submitted commands strictly serialized.
	 * @param line - The command line to run.
	 */
	const runCommand = (line: string) => {
		running = true;
		render();
		void onCommand(line)
			// `onCommand`'s contract (see `CreateCrawlConsoleOptions.onCommand`)
			// is to always resolve, never reject — every current caller
			// (`createCrawlConsoleCommandHandler` in `commands/crawl.ts`)
			// upholds that. This catch exists only so a future violation of
			// that contract degrades to a visible status line instead of an
			// unhandled rejection, which — with nothing else in the CLI
			// listening for one — would crash the whole (possibly hours-long)
			// crawl process outright.
			.catch(
				(error: unknown) =>
					`✖ internal error: ${error instanceof Error ? error.message : String(error)}`,
			)
			.then((result) => {
				if (disposed) return;
				status = result;
				const next = pendingLines.shift();
				if (next !== undefined) {
					runCommand(next);
					return;
				}
				running = false;
				render();
			});
	};

	const submit = () => {
		const line = buffer;
		buffer = '';
		if (line.trim() === '') {
			render();
			return;
		}
		if (running) {
			pendingLines.push(line);
			render();
			return;
		}
		runCommand(line);
	};

	const clearEscapeTimer = () => {
		if (escapeTimer) {
			clearTimeout(escapeTimer);
			escapeTimer = null;
		}
	};

	/**
	 * Fires {@link ESCAPE_TIMEOUT_MS} after {@link pendingEscape} was set
	 * with nothing further received to resolve it: a lone `ESC` resolves as
	 * a real Escape keypress (clears the buffer); an incomplete CSI sequence
	 * (`ESC '['` with no final byte) is discarded silently — there is
	 * nothing sensible to apply from a sequence that never completed.
	 */
	const resolvePendingEscapeOnTimeout = () => {
		escapeTimer = null;
		const pending = pendingEscape;
		pendingEscape = '';
		if (pending === ESC) {
			buffer = '';
		}
		render();
	};

	const handleData = (rawChunk: string) => {
		clearEscapeTimer();
		const chunk = pendingEscape + rawChunk;
		pendingEscape = '';
		let i = 0;
		while (i < chunk.length) {
			const char = chunk[i]!;

			if (char === CTRL_C) {
				onInterrupt();
				return;
			}

			if (char === ESC) {
				// Ambiguous until we can see the next byte (bare Escape) or
				// the CSI sequence's final byte (ESC '[' ... <0x40-0x7E>) —
				// in either case, if the chunk ends before that's resolved,
				// stash the tail and start `escapeTimer` instead of guessing
				// (see `pendingEscape`'s own JSDoc for why this can happen).
				if (i + 1 >= chunk.length) {
					pendingEscape = chunk.slice(i);
					escapeTimer = setTimeout(resolvePendingEscapeOnTimeout, ESCAPE_TIMEOUT_MS);
					break;
				}
				if (chunk[i + 1] === '[') {
					let end = i + 2;
					while (end < chunk.length) {
						const code = chunk.codePointAt(end) ?? 0;
						// This repo's lint pipeline runs eslint --fix before prettier,
						// and prettier always lowercases hex digits back down, so the
						// two perpetually fight over 0x7e/0x7E; only `lint:eslint:check`
						// (no --fix, matching CI) ever surfaces the resulting mismatch.
						// eslint-disable-next-line unicorn/number-literal-case
						if (code >= 0x40 && code <= 0x7e) {
							break;
						}
						end++;
					}
					if (end >= chunk.length) {
						pendingEscape = chunk.slice(i);
						escapeTimer = setTimeout(resolvePendingEscapeOnTimeout, ESCAPE_TIMEOUT_MS);
						break;
					}
					i = end + 1;
					continue;
				}
				// Bare Escape (not followed by '['): clear the buffer.
				buffer = '';
				i++;
				continue;
			}

			if (char === '\r' || char === '\n') {
				submit();
				i++;
				continue;
			}

			if (char === DEL || char === BS) {
				buffer = buffer.slice(0, -1);
				i++;
				continue;
			}

			if (char === CTRL_U) {
				buffer = '';
				i++;
				continue;
			}

			if ((char.codePointAt(0) ?? 0) < 0x20) {
				// Other C0 controls (Ctrl-D, Ctrl-Z, Ctrl-\, ...): not meaningful
				// for a single-line command buffer.
				i++;
				continue;
			}

			buffer += char;
			i++;
		}
		render();
	};

	stdin.setEncoding('utf8');
	stdin.setRawMode(true);
	stdin.on('data', handleData);
	stdin.resume();
	// Hides the terminal's own cursor so the drawn `▌`/`…` at the end of the
	// input line is the only cursor-like glyph on screen — without this, the
	// real cursor sits on the blank line `Display#write()` always leaves
	// below the last rendered line (every frame ends with a trailing `\n`),
	// which reads as a second, misplaced cursor.
	stream.write(HIDE_CURSOR);
	render();

	return {
		dispose() {
			if (disposed) return;
			disposed = true;
			clearEscapeTimer();
			stdin.off('data', handleData);
			stdin.setRawMode(false);
			stdin.pause();
			stream.write(SHOW_CURSOR);
			lanes.clear({ footer: true });
		},
	};
}
