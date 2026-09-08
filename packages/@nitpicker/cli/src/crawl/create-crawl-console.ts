import type { CrawlConsoleHandle, CrawlConsoleInput } from './types.js';
import type { Lanes } from '@d-zero/dealer';

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

/** Options for {@link createCrawlConsole}. */
export interface CreateCrawlConsoleOptions {
	/** The stdin-like stream to read keystrokes from. */
	readonly stdin: CrawlConsoleInput;
	/**
	 * The `Lanes` instance the crawl body's `deal()` call is also using
	 * (injected via `Crawler`'s `lanes` option) — the console renders its
	 * input line as this `Lanes`' footer, below the crawl progress lanes.
	 */
	readonly lanes: Lanes;
	/**
	 * Called with the trimmed, non-empty line once Enter is pressed. The
	 * resolved string becomes the status line shown above the input line
	 * until the next command is submitted.
	 */
	readonly onCommand: (line: string) => Promise<string>;
	/** Called on Ctrl-C — the caller decides what "interrupt" means (abort the crawl, same as the terminal's own SIGINT would have). */
	readonly onInterrupt: () => void;
}

/**
 * Draws an always-visible input line as the crawl `Lanes`' footer and turns
 * raw keystrokes from `stdin` into submitted commands, Ink/Claude-Code-style
 * — an input box baked into the same redraw frame as the log lines above it,
 * rather than a separate readline prompt (which would fight `Lanes`/`Display`
 * for the terminal, see `ARCHITECTURE.md`'s single-Lanes-instance invariant).
 *
 * Enter submits the current buffer as one command (see
 * `parseCrawlConsoleCommand`); Backspace/Delete removes the last character;
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
 * @param options - See {@link CreateCrawlConsoleOptions}.
 * @returns A handle to restore stdin and clear the footer. Caller must call
 *   `dispose()` on every exit path (crawl finishes, fails, or is aborted) —
 *   `stdin` is left in raw mode and paused (`resume()`d here) otherwise,
 *   which would leave the terminal in a broken state after the process exits.
 * @example
 * ```ts
 * const console = createCrawlConsole({
 *   stdin: process.stdin,
 *   lanes,
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
	const { stdin, lanes, onCommand, onInterrupt } = options;

	let buffer = '';
	let status = '';
	let running = false;
	let disposed = false;
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

	const submit = () => {
		const line = buffer;
		buffer = '';
		if (line.trim() === '') {
			render();
			return;
		}
		running = true;
		render();
		void onCommand(line).then((result) => {
			if (disposed) return;
			running = false;
			status = result;
			render();
		});
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
	render();

	return {
		dispose() {
			if (disposed) return;
			disposed = true;
			clearEscapeTimer();
			stdin.off('data', handleData);
			stdin.setRawMode(false);
			stdin.pause();
			lanes.clear({ footer: true });
		},
	};
}
