import type { CrawlConsoleInput } from './types.js';
import type { Lanes } from '@d-zero/dealer';

import { EventEmitter } from 'node:events';

import { describe, it, expect, vi } from 'vitest';

import { createCrawlConsole } from './create-crawl-console.js';

/**
 * A minimal `CrawlConsoleInput` double backed by a real `EventEmitter`, so
 * `on('data', ...)`/`off('data', ...)` behave exactly like `process.stdin`
 * without touching the real stream (raw mode, encoding) during a test run.
 */
class FakeStdin extends EventEmitter implements CrawlConsoleInput {
	encoding: string | undefined;
	isTTY = true;
	paused = true;
	rawMode = false;

	pause() {
		this.paused = true;
	}
	resume() {
		this.paused = false;
	}
	setEncoding(encoding: BufferEncoding) {
		this.encoding = encoding;
	}
	setRawMode(mode: boolean) {
		this.rawMode = mode;
	}

	/**
	 * Test helper: simulates a keystroke/paste arriving as one `data` chunk.
	 * @param chunk
	 */
	type(chunk: string) {
		this.emit('data', chunk);
	}
}

/**
 * Builds a `Lanes` double exposing only `footer`/`clear` as spies — enough
 * to assert what `createCrawlConsole` renders without fighting the real
 * `Lanes`/`Display`'s frame-timer buffering (see `@d-zero/dealer`'s own
 * `lanes.spec.ts` for why a real instance needs a forced `resize` to
 * observe anything past the first synchronous frame).
 * @returns The fake `Lanes` and its `footer`/`clear` spies.
 */
function createFakeLanes() {
	const footer = vi.fn();
	const clear = vi.fn();
	const lanes = { footer, clear } as unknown as Lanes;
	return { lanes, footer, clear };
}

describe('createCrawlConsole', () => {
	it('puts stdin into raw mode, sets utf8 encoding, and resumes it on creation', () => {
		const stdin = new FakeStdin();
		const { lanes } = createFakeLanes();

		createCrawlConsole({ stdin, lanes, onCommand: vi.fn(), onInterrupt: vi.fn() });

		expect(stdin.rawMode).toBe(true);
		expect(stdin.encoding).toBe('utf8');
		expect(stdin.paused).toBe(false);
	});

	it('draws an empty input line immediately', () => {
		const stdin = new FakeStdin();
		const { lanes, footer } = createFakeLanes();

		createCrawlConsole({ stdin, lanes, onCommand: vi.fn(), onInterrupt: vi.fn() });

		expect(footer).toHaveBeenCalledWith('> ▌');
	});

	it('appends typed characters to the input line', () => {
		const stdin = new FakeStdin();
		const { lanes, footer } = createFakeLanes();

		createCrawlConsole({ stdin, lanes, onCommand: vi.fn(), onInterrupt: vi.fn() });
		stdin.type('parallels 4');

		expect(footer).toHaveBeenLastCalledWith('> parallels 4▌');
	});

	it('Enter on a non-empty buffer shows a running indicator, then the resolved status once onCommand resolves', async () => {
		const stdin = new FakeStdin();
		const { lanes, footer } = createFakeLanes();
		const { promise: canResolve, resolve } = Promise.withResolvers<string>();
		const onCommand = vi.fn(() => canResolve);

		createCrawlConsole({ stdin, lanes, onCommand, onInterrupt: vi.fn() });
		stdin.type('parallels 4');
		stdin.type('\r');

		expect(onCommand).toHaveBeenCalledWith('parallels 4');
		expect(footer).toHaveBeenLastCalledWith('>  …');

		resolve('parallels: 4');
		await canResolve;
		await vi.waitFor(() => {
			expect(footer).toHaveBeenLastCalledWith('parallels: 4\n> ▌');
		});
	});

	it('Enter on an empty or whitespace-only buffer does not call onCommand', () => {
		const stdin = new FakeStdin();
		const { lanes } = createFakeLanes();
		const onCommand = vi.fn();

		createCrawlConsole({ stdin, lanes, onCommand, onInterrupt: vi.fn() });
		stdin.type('   ');
		stdin.type('\r');

		expect(onCommand).not.toHaveBeenCalled();
	});

	it('Backspace removes the last character', () => {
		const stdin = new FakeStdin();
		const { lanes, footer } = createFakeLanes();

		createCrawlConsole({ stdin, lanes, onCommand: vi.fn(), onInterrupt: vi.fn() });
		stdin.type('help');
		stdin.type('\u007F');

		expect(footer).toHaveBeenLastCalledWith('> hel▌');
	});

	it('Ctrl-U clears the buffer', () => {
		const stdin = new FakeStdin();
		const { lanes, footer } = createFakeLanes();

		createCrawlConsole({ stdin, lanes, onCommand: vi.fn(), onInterrupt: vi.fn() });
		stdin.type('help');
		stdin.type('\u0015');

		expect(footer).toHaveBeenLastCalledWith('> ▌');
	});

	it('a bare Escape (nothing following) clears the buffer once the ambiguity timeout fires', () => {
		vi.useFakeTimers();
		try {
			const stdin = new FakeStdin();
			const { lanes, footer } = createFakeLanes();

			createCrawlConsole({ stdin, lanes, onCommand: vi.fn(), onInterrupt: vi.fn() });
			stdin.type('help');
			stdin.type('\u001B');
			// Nothing distinguishes a lone Escape from the first byte of a CSI
			// sequence until either more input arrives or this timeout elapses
			// (see `ESCAPE_TIMEOUT_MS`'s JSDoc) — not cleared yet at this point.
			expect(footer).toHaveBeenLastCalledWith('> help▌');

			vi.advanceTimersByTime(50);

			expect(footer).toHaveBeenLastCalledWith('> ▌');
		} finally {
			vi.useRealTimers();
		}
	});

	it('discards an ANSI CSI sequence (arrow key) instead of injecting it into the buffer', () => {
		const stdin = new FakeStdin();
		const { lanes, footer } = createFakeLanes();

		createCrawlConsole({ stdin, lanes, onCommand: vi.fn(), onInterrupt: vi.fn() });
		stdin.type('ab');
		stdin.type('\u001B[A'); // up-arrow
		stdin.type('c');

		expect(footer).toHaveBeenLastCalledWith('> abc▌');
	});

	it('discards an ANSI CSI sequence split across multiple data chunks (fragmented stdin read)', () => {
		const stdin = new FakeStdin();
		const { lanes, footer } = createFakeLanes();

		createCrawlConsole({ stdin, lanes, onCommand: vi.fn(), onInterrupt: vi.fn() });
		stdin.type('ab');
		stdin.type('\u001B'); // ESC alone — ambiguous, must wait for more input
		stdin.type('['); // now a CSI sequence, still no final byte
		stdin.type('A'); // final byte (up-arrow) arrives in its own chunk
		stdin.type('c');

		expect(footer).toHaveBeenLastCalledWith('> abc▌');
	});

	it('treats a buffered Escape as a real Escape once the next chunk is a plain character, not "["', () => {
		const stdin = new FakeStdin();
		const { lanes, footer } = createFakeLanes();

		createCrawlConsole({ stdin, lanes, onCommand: vi.fn(), onInterrupt: vi.fn() });
		stdin.type('help');
		stdin.type('\u001B'); // ESC alone, chunk ends — ambiguous, buffered
		stdin.type('x'); // next chunk starts with a plain character, not "["

		// The buffered ESC resolves to a bare Escape (clears "help"), then
		// "x" is typed fresh into the now-empty buffer.
		expect(footer).toHaveBeenLastCalledWith('> x▌');
	});

	it('silently discards an incomplete CSI sequence once the ambiguity timeout fires with no final byte ever arriving', () => {
		vi.useFakeTimers();
		try {
			const stdin = new FakeStdin();
			const { lanes, footer } = createFakeLanes();

			createCrawlConsole({ stdin, lanes, onCommand: vi.fn(), onInterrupt: vi.fn() });
			stdin.type('ab');
			stdin.type('\u001B['); // start of a CSI sequence, final byte never arrives

			vi.advanceTimersByTime(50);

			// Neither cleared (it wasn't a bare Escape) nor polluted with the
			// incomplete sequence's raw bytes — "ab" is left untouched.
			expect(footer).toHaveBeenLastCalledWith('> ab▌');
		} finally {
			vi.useRealTimers();
		}
	});

	it('Ctrl-C calls onInterrupt and does not submit the buffer', () => {
		const stdin = new FakeStdin();
		const { lanes } = createFakeLanes();
		const onCommand = vi.fn();
		const onInterrupt = vi.fn();

		createCrawlConsole({ stdin, lanes, onCommand, onInterrupt });
		stdin.type('parallels 4');
		stdin.type('\u0003');

		expect(onInterrupt).toHaveBeenCalledTimes(1);
		expect(onCommand).not.toHaveBeenCalled();
	});

	it('dispose() restores stdin and clears the footer', () => {
		const stdin = new FakeStdin();
		const { lanes, clear } = createFakeLanes();

		const handle = createCrawlConsole({
			stdin,
			lanes,
			onCommand: vi.fn(),
			onInterrupt: vi.fn(),
		});
		handle.dispose();

		expect(stdin.rawMode).toBe(false);
		expect(stdin.paused).toBe(true);
		expect(clear).toHaveBeenCalledWith({ footer: true });
	});

	it('dispose() detaches the data listener, so further keystrokes have no effect', () => {
		const stdin = new FakeStdin();
		const { lanes, footer } = createFakeLanes();
		const onInterrupt = vi.fn();

		const handle = createCrawlConsole({
			stdin,
			lanes,
			onCommand: vi.fn(),
			onInterrupt,
		});
		handle.dispose();
		footer.mockClear();
		stdin.type('x');
		stdin.type('\u0003');

		expect(footer).not.toHaveBeenCalled();
		expect(onInterrupt).not.toHaveBeenCalled();
	});

	it('dispose() is idempotent', () => {
		const stdin = new FakeStdin();
		const { lanes, clear } = createFakeLanes();

		const handle = createCrawlConsole({
			stdin,
			lanes,
			onCommand: vi.fn(),
			onInterrupt: vi.fn(),
		});
		handle.dispose();
		handle.dispose();

		expect(clear).toHaveBeenCalledTimes(1);
	});

	it('dispose() clears a pending ambiguous-Escape timer instead of leaking it', () => {
		vi.useFakeTimers();
		try {
			const stdin = new FakeStdin();
			const { lanes, footer } = createFakeLanes();

			const handle = createCrawlConsole({
				stdin,
				lanes,
				onCommand: vi.fn(),
				onInterrupt: vi.fn(),
			});
			stdin.type('help');
			stdin.type('\u001B'); // ESC alone — starts the ambiguity timer
			handle.dispose();
			footer.mockClear();

			vi.advanceTimersByTime(50);

			// If the timer weren't cleared, it would fire here and call
			// `render()` (`lanes.footer()`) on an already-disposed console.
			expect(footer).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('a command resolving after dispose() does not re-render the footer', async () => {
		const stdin = new FakeStdin();
		const { lanes, footer, clear } = createFakeLanes();
		const { promise: canResolve, resolve } = Promise.withResolvers<string>();
		const onCommand = vi.fn(() => canResolve);

		const handle = createCrawlConsole({ stdin, lanes, onCommand, onInterrupt: vi.fn() });
		stdin.type('parallels 4');
		stdin.type('\r');
		handle.dispose();
		footer.mockClear();
		clear.mockClear();

		resolve('parallels: 4');
		await canResolve;
		await Promise.resolve();

		expect(footer).not.toHaveBeenCalled();
	});
});
