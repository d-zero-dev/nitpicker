import type { BufferedPhaseError } from './drain-phase-errors.js';
import type { ChangePhaseEvent } from '@d-zero/beholder';

import { describe, expect, it, vi } from 'vitest';

import { createChangePhaseHandler } from './create-change-phase-handler.js';

/**
 * Builds a `ChangePhaseEvent` with the fields the handler actually touches.
 * Extra fields are defaulted so individual tests stay focused.
 * @param overrides - Fields to override on the default event shape.
 * @returns A {@link ChangePhaseEvent} suitable for the handler.
 */
function makeEvent(overrides: Partial<ChangePhaseEvent> = {}): ChangePhaseEvent {
	return {
		pid: 1234,
		name: 'openPage',
		url: null,
		isExternal: false,
		message: 'msg',
		...overrides,
	};
}

/**
 * Builds a `ChangePhaseHandlerOptions` value with sensible defaults.
 * Tests override only the fields they care about.
 * @param overrides
 */
function buildOptions(
	overrides: Partial<Parameters<typeof createChangePhaseHandler>[0]> = {},
): Parameters<typeof createChangePhaseHandler>[0] {
	return {
		emit: vi.fn(),
		update: vi.fn(),
		formatLog: vi.fn(() => 'formatted'),
		buffer: new Map<string, BufferedPhaseError[]>(),
		urlHref: 'https://example.com/',
		...overrides,
	};
}

describe('createChangePhaseHandler', () => {
	it('forwards every event through emit unchanged', () => {
		const emit = vi.fn();
		const handler = createChangePhaseHandler(buildOptions({ emit }));

		const event = makeEvent({ name: 'openPage', message: 'opening' });
		handler(event);

		expect(emit).toHaveBeenCalledExactlyOnceWith(event);
	});

	it('does not buffer events whose name is not retryExhausted', () => {
		const buffer = new Map<string, BufferedPhaseError[]>();
		const handler = createChangePhaseHandler(buildOptions({ buffer }));

		handler(makeEvent({ name: 'openPage', message: 'opening' }));
		handler(makeEvent({ name: 'getImages', message: 'images' }));

		expect(buffer.size).toBe(0);
	});

	it('buffers a retryExhausted event into the per-URL buffer', () => {
		const buffer = new Map<string, BufferedPhaseError[]>();
		const handler = createChangePhaseHandler(
			buildOptions({ buffer, urlHref: 'https://example.com/wedged' }),
		);

		handler(
			makeEvent({
				name: 'retryExhausted',
				message: '📷 mobile-small: skipped — Attempted to use detached Frame',
			}),
		);

		expect(buffer.get('https://example.com/wedged')).toEqual([
			{
				phase: 'retryExhausted',
				message: '📷 mobile-small: skipped — Attempted to use detached Frame',
			},
		]);
	});

	it('appends a second retryExhausted to the same URL bucket', () => {
		const buffer = new Map<string, BufferedPhaseError[]>();
		const handler = createChangePhaseHandler(
			buildOptions({ buffer, urlHref: 'https://example.com/wedged' }),
		);

		handler(makeEvent({ name: 'retryExhausted', message: 'first' }));
		handler(makeEvent({ name: 'retryExhausted', message: 'second' }));

		expect(buffer.get('https://example.com/wedged')).toEqual([
			{ phase: 'retryExhausted', message: 'first' },
			{ phase: 'retryExhausted', message: 'second' },
		]);
	});

	it('keys the buffer strictly by the supplied urlHref (no cross-URL contamination)', () => {
		const buffer = new Map<string, BufferedPhaseError[]>();
		const handlerA = createChangePhaseHandler(
			buildOptions({ buffer, urlHref: 'https://example.com/a' }),
		);
		const handlerB = createChangePhaseHandler(
			buildOptions({ buffer, urlHref: 'https://example.com/b' }),
		);

		handlerA(makeEvent({ name: 'retryExhausted', message: 'a-err' }));
		handlerB(makeEvent({ name: 'retryExhausted', message: 'b-err' }));

		expect(buffer.get('https://example.com/a')).toEqual([
			{ phase: 'retryExhausted', message: 'a-err' },
		]);
		expect(buffer.get('https://example.com/b')).toEqual([
			{ phase: 'retryExhausted', message: 'b-err' },
		]);
	});

	it('calls update with the formatLog output when it is a non-empty string', () => {
		const update = vi.fn();
		const formatLog = vi.fn(() => 'opening page');
		const handler = createChangePhaseHandler(buildOptions({ update, formatLog }));

		const event = makeEvent({ name: 'openPage', message: 'opening' });
		handler(event);

		expect(formatLog).toHaveBeenCalledExactlyOnceWith(event);
		expect(update).toHaveBeenCalledExactlyOnceWith('opening page');
	});

	it('skips update when formatLog returns null (phase with no log line)', () => {
		// formatLog returns null for scrapeStart/scrapeEnd etc. The handler
		// must not spam the progress UI with empty lines.
		const update = vi.fn();
		const formatLog = vi.fn(() => null);
		const handler = createChangePhaseHandler(buildOptions({ update, formatLog }));

		handler(makeEvent({ name: 'scrapeStart' }));

		expect(formatLog).toHaveBeenCalledOnce();
		expect(update).not.toHaveBeenCalled();
	});

	it('skips update when formatLog returns an empty string', () => {
		const update = vi.fn();
		const handler = createChangePhaseHandler(
			buildOptions({ update, formatLog: () => '' }),
		);

		handler(makeEvent({ name: 'whatever' }));

		expect(update).not.toHaveBeenCalled();
	});

	it('still forwards via emit even when update is skipped', () => {
		// Phases with no log line must still reach external listeners — emit() is
		// the single source of truth for the changePhase channel.
		const emit = vi.fn();
		const handler = createChangePhaseHandler(
			buildOptions({ emit, formatLog: () => null }),
		);

		const event = makeEvent({ name: 'scrapeStart' });
		handler(event);

		expect(emit).toHaveBeenCalledExactlyOnceWith(event);
	});
});
