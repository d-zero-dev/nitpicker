import type { Lanes } from '@d-zero/dealer';
import type { Cell, Sheet } from '@d-zero/google-sheets';

import { describe, it, expect, vi } from 'vitest';

import { createRowStreamer } from './create-row-streamer.js';

/**
 * Builds a fake row of N cells; values don't matter for streamer tests
 * since the streamer treats rows as opaque payloads.
 * @param marker - A string tag to disambiguate row sources in assertions.
 */
function fakeRow(marker: string): Cell[] {
	return [{ provide: () => ({ marker }) } as unknown as Cell];
}

/**
 * Creates a stub Sheet whose `addRowData` records every call so tests can
 * inspect the chunking pattern produced by `createRowStreamer`.
 */
function createFakeSheet() {
	const calls: Cell[][][] = [];
	const sheet = {
		addRowData: vi.fn((data: Cell[][]) => {
			// Snapshot the array contents at call time so subsequent splice() ops
			// on the streamer's internal buffer don't mutate what we recorded.
			calls.push([...data]);
			return Promise.resolve();
		}),
	} as unknown as Sheet;
	return { sheet, calls };
}

/**
 * Creates a stub Lanes that records every `update()` call so tests can
 * assert on progress display text.
 */
function createFakeLanes() {
	const updates: { id: number; text: string }[] = [];
	const lanes = {
		update: vi.fn((id: number, text: string) => {
			updates.push({ id, text });
		}),
	} as unknown as Lanes;
	return { lanes, updates };
}

describe('createRowStreamer', () => {
	it('does not flush until the buffer reaches SEND_CHUNK_SIZE', async () => {
		const { sheet, calls } = createFakeSheet();
		const streamer = createRowStreamer(sheet, 'Test', undefined, 0);

		// SEND_CHUNK_SIZE is 2500; pushing 2499 rows must not trigger any send.
		await streamer.push(Array.from({ length: 2499 }, () => fakeRow('a')));
		expect(calls).toHaveLength(0);
		expect(streamer.sent).toBe(0);
	});

	it('auto-flushes exactly one chunk when the buffer hits SEND_CHUNK_SIZE', async () => {
		const { sheet, calls } = createFakeSheet();
		const streamer = createRowStreamer(sheet, 'Test', undefined, 0);

		await streamer.push(Array.from({ length: 2500 }, () => fakeRow('a')));
		expect(calls).toHaveLength(1);
		expect(calls[0]).toHaveLength(2500);
		expect(streamer.sent).toBe(2500);
	});

	it('auto-flushes multiple chunks when push() crosses the threshold repeatedly', async () => {
		const { sheet, calls } = createFakeSheet();
		const streamer = createRowStreamer(sheet, 'Test', undefined, 0);

		// 6000 rows in one push → two full chunks of 2500 + 1000 remaining.
		await streamer.push(Array.from({ length: 6000 }, () => fakeRow('a')));
		expect(calls).toHaveLength(2);
		expect(calls[0]).toHaveLength(2500);
		expect(calls[1]).toHaveLength(2500);
		expect(streamer.sent).toBe(5000);
	});

	it('flush() sends the remaining tail in a final chunk', async () => {
		const { sheet, calls } = createFakeSheet();
		const streamer = createRowStreamer(sheet, 'Test', undefined, 0);

		await streamer.push(Array.from({ length: 6000 }, () => fakeRow('a')));
		await streamer.flush();

		expect(calls).toHaveLength(3);
		expect(calls[0]).toHaveLength(2500);
		expect(calls[1]).toHaveLength(2500);
		expect(calls[2]).toHaveLength(1000);
		expect(streamer.sent).toBe(6000);
	});

	it('flush() on an empty buffer is a no-op', async () => {
		const { sheet, calls } = createFakeSheet();
		const streamer = createRowStreamer(sheet, 'Test', undefined, 0);

		await streamer.flush();
		expect(calls).toHaveLength(0);
		expect(streamer.sent).toBe(0);
	});

	it('preserves row order across chunks', async () => {
		const { sheet, calls } = createFakeSheet();
		const streamer = createRowStreamer(sheet, 'Test', undefined, 0);

		// Push rows with distinct markers so we can verify ordering.
		await streamer.push(Array.from({ length: 2500 }, (_, i) => fakeRow(`first-${i}`)));
		await streamer.push(Array.from({ length: 2500 }, (_, i) => fakeRow(`second-${i}`)));
		await streamer.flush();

		// First flushed chunk must contain the "first-*" rows, in order.
		const firstChunk = calls[0]!;
		expect(
			firstChunk.map(
				(row) =>
					(row[0] as unknown as { provide(): { marker: string } }).provide().marker,
			),
		).toEqual(Array.from({ length: 2500 }, (_, i) => `first-${i}`));
		// Second flushed chunk must contain the "second-*" rows, in order.
		const secondChunk = calls[1]!;
		expect(
			secondChunk.map(
				(row) =>
					(row[0] as unknown as { provide(): { marker: string } }).provide().marker,
			),
		).toEqual(Array.from({ length: 2500 }, (_, i) => `second-${i}`));
	});

	it('updates the Lanes display with cumulative sent count after each flush', async () => {
		const { sheet } = createFakeSheet();
		const { lanes, updates } = createFakeLanes();
		const streamer = createRowStreamer(sheet, 'Links', lanes, 7);

		await streamer.push(Array.from({ length: 6000 }, () => fakeRow('a')));
		await streamer.flush();

		// 3 flushes (2500 + 2500 + 1000) produce 3 lane updates with growing counts.
		expect(updates).toEqual([
			{ id: 7, text: 'Links: Sent 2500 rows so far%dots%' },
			{ id: 7, text: 'Links: Sent 5000 rows so far%dots%' },
			{ id: 7, text: 'Links: Sent 6000 rows so far%dots%' },
		]);
	});

	it('works without a Lanes instance', async () => {
		const { sheet, calls } = createFakeSheet();
		const streamer = createRowStreamer(sheet, 'Test', undefined, 0);

		// Should not throw despite lanes being undefined.
		await streamer.push(Array.from({ length: 2500 }, () => fakeRow('a')));
		await streamer.flush();

		expect(calls).toHaveLength(1);
		expect(streamer.sent).toBe(2500);
	});

	it('caps peak buffer size at SEND_CHUNK_SIZE-1 between flushes', async () => {
		// This is the memory-safety invariant: the streamer must never hold
		// more than SEND_CHUNK_SIZE - 1 rows internally between flushes.
		// We observe this by checking residue = pushed - sent after each push.
		// SEND_CHUNK_SIZE is 2500, so residue must always stay < 2500.
		const { sheet } = createFakeSheet();
		const streamer = createRowStreamer(sheet, 'Test', undefined, 0);

		let pushed = 0;
		const residues: number[] = [];
		for (let i = 0; i < 10; i++) {
			await streamer.push(Array.from({ length: 1000 }, () => fakeRow(`batch-${i}`)));
			pushed += 1000;
			residues.push(pushed - streamer.sent);
		}
		// Every observed residue must be below the chunk threshold.
		for (const residue of residues) {
			expect(residue).toBeLessThan(2500);
		}
		// After the final flush, residue is zero.
		await streamer.flush();
		expect(streamer.sent).toBe(pushed);
		expect(streamer.sent).toBe(10_000);
	});
});
