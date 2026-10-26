import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createResourceFixtureArchive } from './test-helpers/create-resource-fixture-archive.js';

const searched = vi.hoisted(() => ({
	calls: [] as { signal?: AbortSignal; snapshots: readonly unknown[] }[],
	failWith: undefined as Error | undefined,
}));

vi.mock('@nitpicker/archive/html-snapshot/search-html-snapshots', () => ({
	searchHtmlSnapshots: (options: { signal?: AbortSignal; snapshots: unknown[] }) => {
		searched.calls.push(options);
		if (searched.failWith) {
			return Promise.reject(searched.failWith);
		}
		return Promise.resolve(options.snapshots.map(() => ({ matchCount: 0, snippet: '' })));
	},
}));

const { searchHtml } = await import('./search-html.js');

const workingDir = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	'__test_fixtures_search_html_signal__',
);

describe('searchHtml with a signal', () => {
	let archive: Awaited<ReturnType<typeof createResourceFixtureArchive>>;

	beforeAll(async () => {
		archive = await createResourceFixtureArchive(
			workingDir,
			'search-html-signal.nitpicker',
		);
	});

	afterAll(async () => {
		await archive?.close();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('hands the caller’s signal to the native search of every batch', async () => {
		searched.calls.length = 0;
		const controller = new AbortController();
		await searchHtml(archive, { pattern: 'needle', signal: controller.signal });
		expect(searched.calls.length).toBeGreaterThan(0);
		for (const call of searched.calls) {
			expect(call.signal).toBe(controller.signal);
		}
	});

	it('hands over no signal when the caller gave none', async () => {
		searched.calls.length = 0;
		await searchHtml(archive, { pattern: 'needle' });
		expect(searched.calls[0]!.signal).toBeUndefined();
	});

	it('rejects with what the native search rejects with when it stops on the signal', async () => {
		const reason = new Error('client went away');
		searched.failWith = reason;
		try {
			await expect(
				searchHtml(archive, { pattern: 'needle', signal: new AbortController().signal }),
			).rejects.toBe(reason);
		} finally {
			searched.failWith = undefined;
		}
	});
});
