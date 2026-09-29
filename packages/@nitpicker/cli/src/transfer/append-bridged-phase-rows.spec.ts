import { TaskList, TaskListStepError } from '@d-zero/dealer';
import { describe, it, expect, vi } from 'vitest';

import { appendBridgedPhaseRows } from './append-bridged-phase-rows.js';

/** A minimal writable that records every chunk written to it, verbatim. */
function createCapturingStream() {
	const lines: string[] = [];
	const stream: NodeJS.WritableStream = {
		write: (chunk: string) => {
			lines.push(chunk);
			return true;
		},
		on: () => stream,
		off: () => stream,
	} as unknown as NodeJS.WritableStream;
	return { stream, lines };
}

/**
 * Calls `onAdvance` once per label, yielding a microtask tick after each
 * call so dealer's `TaskListPipeline` has a chance to advance to the next
 * row (mirrors `append-viewer-read-model-phase-rows.spec.ts`'s `driveOnPhase`).
 * @param onAdvance
 * @param count
 */
async function driveAdvances(onAdvance: () => void, count: number): Promise<void> {
	for (let i = 0; i < count; i++) {
		onAdvance();
		await Promise.resolve();
	}
}

describe('appendBridgedPhaseRows', () => {
	it('renders every label as its own row, in order', async () => {
		const run = vi.fn(async (input: number, cb: { onAdvance: () => void }) => {
			await driveAdvances(cb.onAdvance, 3);
			return input * 2;
		});
		const { stream, lines } = createCapturingStream();

		const result = await appendBridgedPhaseRows(TaskList.from(5), ['A', 'B', 'C'], {
			run,
			onResult: (_input, r) => r,
		}).run({ stream, verbose: true });

		expect(result).toBe(10);
		const rendered = lines.join('');
		expect(rendered).toContain('A');
		expect(rendered).toContain('B');
		expect(rendered).toContain('C');
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('renders onProgress updates on the currently active row', async () => {
		const run = vi.fn(
			async (
				input: number,
				cb: {
					onAdvance: () => void;
					onProgress: (processed: number, total: number) => void;
				},
			) => {
				// The bridge's first `onAdvance()` call only announces row 0
				// (already active) — a second call is what actually resolves
				// row 0 and activates row 1, matching the "N labels need N
				// onAdvance calls" contract the other tests in this file rely
				// on (`driveAdvances(cb.onAdvance, labels.length)`).
				cb.onAdvance();
				cb.onProgress(1, 10);
				await Promise.resolve();
				cb.onAdvance();
				await Promise.resolve(); // let row B's step function actually run and become active
				cb.onProgress(2, 10);
				await Promise.resolve();
				return input;
			},
		);
		const { stream, lines } = createCapturingStream();

		await appendBridgedPhaseRows(TaskList.from(1), ['A', 'B'], {
			run,
			onResult: (_input, r) => r,
		}).run({ stream, verbose: true });

		const rendered = lines.join('');
		expect(rendered).toContain('1/10');
		expect(rendered).toContain('2/10');
	});

	it('rejects the active row loud when run fails and onFailure is not given', async () => {
		const run = vi.fn(async (_input: number, cb: { onAdvance: () => void }) => {
			cb.onAdvance();
			await Promise.resolve();
			throw new Error('boom');
		});
		const { stream } = createCapturingStream();

		await expect(
			appendBridgedPhaseRows(TaskList.from(1), ['A', 'B'], {
				run,
				onResult: (_input, r) => r as number,
			}).run({ stream }),
		).rejects.toBeInstanceOf(TaskListStepError);
	});

	it('marks remaining rows skipped and resolves with the original input when onFailure is given', async () => {
		const run = vi.fn(async (_input: number, cb: { onAdvance: () => void }) => {
			cb.onAdvance();
			await Promise.resolve();
			throw new Error('boom');
		});
		const { stream, lines } = createCapturingStream();

		const result = await appendBridgedPhaseRows(TaskList.from(7), ['A', 'B'], {
			run,
			onResult: (_input, r) => r as number,
			onFailure: (error) => `failed: ${(error as Error).message}`,
		}).run({ stream, verbose: true });

		expect(result).toBe(7);
		const rendered = lines.join('');
		expect(rendered).toContain('failed: boom');
	});
});
