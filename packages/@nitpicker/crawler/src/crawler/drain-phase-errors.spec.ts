import type { BufferedPhaseError } from './drain-phase-errors.js';

import { describe, expect, it, vi } from 'vitest';

import { drainPhaseErrors } from './drain-phase-errors.js';

describe('drainPhaseErrors', () => {
	it('returns 0 and never calls emit when the buffer has no entry for the URL', () => {
		const buffer = new Map<string, BufferedPhaseError[]>();
		const emit = vi.fn();

		const count = drainPhaseErrors(buffer, 'https://example.com/', false, emit);

		expect(count).toBe(0);
		expect(emit).not.toHaveBeenCalled();
		expect(buffer.size).toBe(0);
	});

	it('returns 0 and never calls emit when the buffered entry is an empty array', () => {
		// An empty array can land in the buffer if a caller calls set() with []
		// directly. The drain must still treat it as a no-op rather than
		// emitting a zero-record stream.
		const buffer = new Map<string, BufferedPhaseError[]>([['https://example.com/', []]]);
		const emit = vi.fn();

		const count = drainPhaseErrors(buffer, 'https://example.com/', false, emit);

		expect(count).toBe(0);
		expect(emit).not.toHaveBeenCalled();
	});

	it('emits one pageError payload per buffered record and deletes the entry', () => {
		const buffer = new Map<string, BufferedPhaseError[]>([
			[
				'https://example.com/page',
				[
					{
						phase: 'retryExhausted',
						message: '📷 desktop-compact: skipped — Session closed',
					},
					{
						phase: 'retryExhausted',
						message: '📷 mobile-small: skipped — Attempted to use detached Frame',
					},
				],
			],
		]);
		const emit = vi.fn();

		const count = drainPhaseErrors(buffer, 'https://example.com/page', false, emit);

		expect(count).toBe(2);
		expect(emit).toHaveBeenCalledTimes(2);
		expect(emit.mock.calls[0]).toEqual([
			{
				url: 'https://example.com/page',
				phase: 'retryExhausted',
				message: '📷 desktop-compact: skipped — Session closed',
				isExternal: false,
			},
		]);
		expect(emit.mock.calls[1]).toEqual([
			{
				url: 'https://example.com/page',
				phase: 'retryExhausted',
				message: '📷 mobile-small: skipped — Attempted to use detached Frame',
				isExternal: false,
			},
		]);
		// The entry is removed so a follow-up drain or finally delete is a no-op.
		expect(buffer.has('https://example.com/page')).toBe(false);
	});

	it('propagates the isExternal flag into every emitted payload', () => {
		const buffer = new Map<string, BufferedPhaseError[]>([
			[
				'https://external.example.com/oops',
				[{ phase: 'retryExhausted', message: 'oops' }],
			],
		]);
		const emit = vi.fn();

		drainPhaseErrors(buffer, 'https://external.example.com/oops', true, emit);

		expect(emit).toHaveBeenCalledExactlyOnceWith({
			url: 'https://external.example.com/oops',
			phase: 'retryExhausted',
			message: 'oops',
			isExternal: true,
		});
	});

	it('does not touch entries for other URLs in the buffer', () => {
		const buffer = new Map<string, BufferedPhaseError[]>([
			['https://example.com/a', [{ phase: 'retryExhausted', message: 'a-err' }]],
			['https://example.com/b', [{ phase: 'retryExhausted', message: 'b-err' }]],
		]);
		const emit = vi.fn();

		drainPhaseErrors(buffer, 'https://example.com/a', false, emit);

		expect(emit).toHaveBeenCalledTimes(1);
		expect(buffer.has('https://example.com/a')).toBe(false);
		expect(buffer.get('https://example.com/b')).toEqual([
			{ phase: 'retryExhausted', message: 'b-err' },
		]);
	});

	it('is idempotent — a second call for the same URL is a no-op', () => {
		const buffer = new Map<string, BufferedPhaseError[]>([
			['https://example.com/', [{ phase: 'retryExhausted', message: 'err' }]],
		]);
		const emit = vi.fn();

		const first = drainPhaseErrors(buffer, 'https://example.com/', false, emit);
		const second = drainPhaseErrors(buffer, 'https://example.com/', false, emit);

		expect(first).toBe(1);
		expect(second).toBe(0);
		expect(emit).toHaveBeenCalledTimes(1);
	});
});
