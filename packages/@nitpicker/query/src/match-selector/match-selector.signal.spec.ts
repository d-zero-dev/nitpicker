import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createHtmlSelectorFixtureArchive } from '../test-helpers/create-html-selector-fixture-archive.js';

const judged = vi.hoisted(() => ({
	calls: [] as { signal?: AbortSignal; snapshots: readonly unknown[] }[],
	failWith: undefined as Error | undefined,
}));

vi.mock('@nitpicker/archive/html-snapshot/match-selector-snapshots', () => ({
	matchSelectorSnapshots: (options: { signal?: AbortSignal; snapshots: unknown[] }) => {
		judged.calls.push(options);
		if (judged.failWith) {
			return Promise.reject(judged.failWith);
		}
		return Promise.resolve(
			options.snapshots.map(() => ({
				matched: false,
				prefiltered: false,
				tokenized: false,
			})),
		);
	},
}));

const { matchSelector } = await import('./match-selector.js');

const workingDir = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	'__test_fixtures_match_selector_signal__',
);

describe('matchSelector with a signal', () => {
	let archive: Awaited<ReturnType<typeof createHtmlSelectorFixtureArchive>>;

	beforeAll(async () => {
		archive = await createHtmlSelectorFixtureArchive({
			workingDir,
			fileName: 'match-selector-signal.nitpicker',
			pages: [{ url: 'https://example.com', html: '<p><img></p>' }],
		});
	});

	afterAll(async () => {
		await archive?.close();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('hands the caller’s signal to the native judge of every batch', async () => {
		judged.calls.length = 0;
		const controller = new AbortController();
		await matchSelector(archive, { selector: 'img', signal: controller.signal });
		expect(judged.calls).toHaveLength(1);
		expect(judged.calls[0]!.signal).toBe(controller.signal);
	});

	it('hands over no signal when the caller gave none', async () => {
		judged.calls.length = 0;
		await matchSelector(archive, { selector: 'img' });
		expect(judged.calls[0]!.signal).toBeUndefined();
	});

	it('rejects with what the native judge rejects with when it stops on the signal', async () => {
		judged.calls.length = 0;
		const reason = new Error('client went away');
		judged.failWith = reason;
		try {
			await expect(
				matchSelector(archive, {
					selector: 'img',
					signal: new AbortController().signal,
				}),
			).rejects.toBe(reason);
		} finally {
			judged.failWith = undefined;
		}
	});
});
