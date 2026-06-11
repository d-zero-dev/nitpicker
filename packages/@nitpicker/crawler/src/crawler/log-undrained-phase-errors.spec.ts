import type { BufferedPhaseError } from './drain-phase-errors.js';

import { describe, expect, it, vi } from 'vitest';

import { logUndrainedPhaseErrors } from './log-undrained-phase-errors.js';

describe('logUndrainedPhaseErrors', () => {
	it('returns 0 and never calls log when nothing was buffered', () => {
		const buffer = new Map<string, BufferedPhaseError[]>();
		const log = vi.fn();

		const dropped = logUndrainedPhaseErrors(buffer, 'https://example.com/', log);

		expect(dropped).toBe(0);
		expect(log).not.toHaveBeenCalled();
		expect(buffer.has('https://example.com/')).toBe(false);
	});

	it('returns 0 and never calls log when the entry exists but is empty', () => {
		// Defensive — a caller can set [] directly. The function must treat
		// it as a no-op rather than emitting a "Dropped 0" message.
		const buffer = new Map<string, BufferedPhaseError[]>([['https://example.com/', []]]);
		const log = vi.fn();

		const dropped = logUndrainedPhaseErrors(buffer, 'https://example.com/', log);

		expect(dropped).toBe(0);
		expect(log).not.toHaveBeenCalled();
		// Even an empty bucket is removed from the Map to keep it bounded.
		expect(buffer.has('https://example.com/')).toBe(false);
	});

	it('logs once with the buffered count and URL, then clears the entry', () => {
		const buffer = new Map<string, BufferedPhaseError[]>([
			[
				'https://example.com/wedged',
				[
					{ phase: 'retryExhausted', message: 'desktop-compact failed' },
					{ phase: 'retryExhausted', message: 'mobile-small failed' },
				],
			],
		]);
		const log = vi.fn();

		const dropped = logUndrainedPhaseErrors(buffer, 'https://example.com/wedged', log);

		expect(dropped).toBe(2);
		expect(log).toHaveBeenCalledExactlyOnceWith(
			'Dropped %d phase error(s) for %s (no archive entry created)',
			2,
			'https://example.com/wedged',
		);
		expect(buffer.has('https://example.com/wedged')).toBe(false);
	});

	it('does not touch entries for other URLs in the buffer', () => {
		const buffer = new Map<string, BufferedPhaseError[]>([
			['https://example.com/a', [{ phase: 'retryExhausted', message: 'a-err' }]],
			['https://example.com/b', [{ phase: 'retryExhausted', message: 'b-err' }]],
		]);
		const log = vi.fn();

		logUndrainedPhaseErrors(buffer, 'https://example.com/a', log);

		expect(buffer.has('https://example.com/a')).toBe(false);
		expect(buffer.get('https://example.com/b')).toEqual([
			{ phase: 'retryExhausted', message: 'b-err' },
		]);
	});

	it('is idempotent — a second call for the same URL is a silent no-op', () => {
		const buffer = new Map<string, BufferedPhaseError[]>([
			['https://example.com/', [{ phase: 'retryExhausted', message: 'err' }]],
		]);
		const log = vi.fn();

		const first = logUndrainedPhaseErrors(buffer, 'https://example.com/', log);
		const second = logUndrainedPhaseErrors(buffer, 'https://example.com/', log);

		expect(first).toBe(1);
		expect(second).toBe(0);
		expect(log).toHaveBeenCalledOnce();
	});
});
