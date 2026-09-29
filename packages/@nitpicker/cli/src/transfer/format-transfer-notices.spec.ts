import type { TransferOutcome } from './types.js';

import { describe, it, expect } from 'vitest';

import { formatTransferNotices } from './format-transfer-notices.js';

const BASE: TransferOutcome = {
	outputPath: '/out/merged.nitpicker',
	fromList: false,
	appendHintRoot: 'https://example.com/',
	externalInScopeCount: 0,
	pendingCount: 0,
	pluginDataEntries: [],
	readModelError: null,
};

describe('formatTransferNotices', () => {
	it('returns nothing when everything is clean', () => {
		expect(formatTransferNotices(BASE)).toEqual([]);
	});

	it('reports in-scope external pages with the append hint', () => {
		const [line] = formatTransferNotices({ ...BASE, externalInScopeCount: 3 });
		expect(line).toContain('3 URLs');
		expect(line).toContain('crawl /out/merged.nitpicker --append https://example.com/');
	});

	it('singularizes the count for exactly one external page', () => {
		const [line] = formatTransferNotices({ ...BASE, externalInScopeCount: 1 });
		expect(line).toContain('1 URL ');
	});

	it('suppresses the append hint for a fromList output', () => {
		expect(
			formatTransferNotices({ ...BASE, fromList: true, externalInScopeCount: 5 }),
		).toEqual([]);
	});

	it('reports pending pages, with a fromList-specific message', () => {
		const [line] = formatTransferNotices({ ...BASE, fromList: true, pendingCount: 2 });
		expect(line).toContain('Warning: 2 URLs');
		expect(line).toContain('list-mode');
	});

	it('reports dropped plugin data with the analyze hint', () => {
		const [line] = formatTransferNotices({
			...BASE,
			pluginDataEntries: ['analysis'],
		});
		expect(line).toContain('analysis');
		expect(line).toContain('analyze /out/merged.nitpicker');
	});

	it('reports a read-model build failure with the rebuild hint', () => {
		const [line] = formatTransferNotices({
			...BASE,
			readModelError: 'out of memory',
		});
		expect(line).toContain('out of memory');
		expect(line).toContain('viewer-build /out/merged.nitpicker');
	});

	it('reports every applicable notice, in the fixed external/pending/plugin-data/read-model order', () => {
		const lines = formatTransferNotices({
			...BASE,
			externalInScopeCount: 1,
			pendingCount: 1,
			pluginDataEntries: ['analysis'],
			readModelError: 'boom',
		});
		expect(lines).toHaveLength(4);
		expect(lines[0]).toContain('external links');
		expect(lines[1]).toContain('Warning:');
		expect(lines[1]).toContain('pending');
		expect(lines[2]).toContain('Analyze plugin data');
		expect(lines[3]).toContain('read model build failed');
	});
});
