import { describe, expect, it } from 'vitest';

import { createSetupTaskList } from './create-setup-task-list.js';

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
 * Yields one microtask tick — the same gap `CrawlerOrchestrator`'s real
 * `onPhase` call sites always have before the next one (each is followed by
 * a genuinely awaited operation), needed here so dealer's `TaskListPipeline`
 * has a chance to advance to the next row before the test calls into it
 * again.
 */
function tick() {
	return Promise.resolve();
}

describe('createSetupTaskList', () => {
	it('advances one pre-built row per onPhase call and resolves on finish()', async () => {
		const { stream } = createCapturingStream();
		const { setupProgress, taskListDone, finish } = createSetupTaskList(
			['Extracting archive', 'Loading archive config', 'Restoring crawl state'],
			{ verbose: true, stream },
		);

		setupProgress.onPhase?.('Extracting archive');
		await tick();
		setupProgress.onPhase?.('Loading archive config');
		await tick();
		setupProgress.onPhase?.('Restoring crawl state');
		await tick();
		finish();

		await expect(taskListDone).resolves.toBeUndefined();
	});

	it('marks pre-built rows never announced as skipped when finish() runs early', async () => {
		const { stream, lines } = createCapturingStream();
		const { setupProgress, taskListDone, finish } = createSetupTaskList(
			['Extracting archive', 'Loading archive config', 'Checking for already-known URLs'],
			{ verbose: true, stream },
		);

		// Only the first phase is ever announced (mirrors inventory's
		// zero-novel-URLs early return, which reaches `initializedCallback`
		// after just one onPhase call).
		setupProgress.onPhase?.('Extracting archive');
		await tick();
		finish();

		await expect(taskListDone).resolves.toBeUndefined();
		const rendered = lines.join('');
		expect(rendered).toContain('Loading archive config');
		expect(rendered).toContain('skipped');
		expect(rendered).toContain('Checking for already-known URLs');
	});

	it('rejects the active row via fail() and stops without running later rows', async () => {
		const { stream } = createCapturingStream();
		const { setupProgress, taskListDone, fail } = createSetupTaskList(
			['Extracting archive', 'Loading archive config'],
			{ verbose: true, stream },
		);

		setupProgress.onPhase?.('Extracting archive');
		await tick();
		const boom = new Error('disk full');
		fail(boom);

		await expect(taskListDone).rejects.toMatchObject({
			cause: boom,
		});
	});

	it('inserts an unplanned recovery-phase row instead of advancing to the next pre-built row', async () => {
		const { stream, lines } = createCapturingStream();
		const { setupProgress, taskListDone, fail } = createSetupTaskList(
			['Extracting archive', 'Loading archive config', 'Backing up archive'],
			{ verbose: true, stream },
		);

		setupProgress.onPhase?.('Extracting archive');
		await tick();
		setupProgress.onPhase?.('Loading archive config');
		await tick();
		setupProgress.onPhase?.('Backing up archive');
		await tick();
		// A failure diverts into the recovery phase instead of continuing
		// past 'Backing up archive'.
		setupProgress.onPhase?.('Restoring archive from backup');
		await tick();
		setupProgress.onCopyProgress?.(50_000_000, 100_000_000);
		const boom = new Error('append failed');
		fail(boom);

		await expect(taskListDone).rejects.toMatchObject({ cause: boom });
		const rendered = lines.join('');
		expect(rendered).toContain('Restoring archive from backup');
		expect(rendered).toContain('50/100 MB');
	});

	it('routes onExtractProgress / onCopyProgress / onChunkProgress to the active row only', async () => {
		const { stream, lines } = createCapturingStream();
		const { setupProgress, taskListDone, finish } = createSetupTaskList(
			['Extracting archive', 'Loading resource list'],
			{ verbose: true, stream },
		);

		// Progress calls before any row is active are no-ops, not throws.
		expect(() => setupProgress.onExtractProgress?.(1_000_000, 2_000_000)).not.toThrow();
		setupProgress.onPhase?.('Extracting archive');
		await tick();
		setupProgress.onExtractProgress?.(1_000_000, 2_000_000);
		setupProgress.onPhase?.('Loading resource list');
		await tick();
		setupProgress.onChunkProgress?.(3, 10);
		finish();

		await expect(taskListDone).resolves.toBeUndefined();
		const rendered = lines.join('');
		expect(rendered).toContain('1/2 MB');
		expect(rendered).toContain('3/10 pages');
	});

	it('finish() and fail() are no-ops once the task list has already settled', async () => {
		const { stream } = createCapturingStream();
		const { setupProgress, taskListDone, finish, fail } = createSetupTaskList(
			['Extracting archive'],
			{ verbose: true, stream },
		);

		setupProgress.onPhase?.('Extracting archive');
		finish();
		await taskListDone;

		// Neither call should throw or produce a second, unhandled rejection.
		expect(() => finish()).not.toThrow();
		expect(() => fail(new Error('too late'))).not.toThrow();
	});
});
