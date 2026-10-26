import type { SelectorPlan } from './types.js';

import { zstdCompressSync } from 'node:zlib';

import { describe, it, expect } from 'vitest';

import { createTemplateClassificationRun } from './create-template-classification-run.js';
import { matchSelectorSnapshots } from './match-selector-snapshots.js';

const IMG_PLAN: SelectorPlan = {
	alternatives: [
		{
			compounds: [{ tag: 'img', attributes: [], nth: [], negations: [] }],
			combinators: [],
			prefilterLiterals: ['<img'],
			direct: true,
		},
	],
	needsChildIndex: false,
	needsTypeIndex: false,
};

describe('the native executor’s concurrency limit', () => {
	// The limit is 1 unless NITPICKER_NATIVE_CONCURRENCY says otherwise, so a
	// template classification call issued while a selector scan is running waits
	// for it instead of racing it for the pool. Without the gate the classification
	// of two tiny pages settles long before the scan of 200 documents does.
	it('runs a classification call after the selector scan that was already running', async () => {
		const body = zstdCompressSync(Buffer.from(`<p>${'a'.repeat(100_000)}</p>`, 'utf8'));
		const settled: string[] = [];

		const scan = matchSelectorSnapshots({
			plan: IMG_PLAN,
			snapshots: Array.from({ length: 200 }, () => ({ body, codec: 'zstd' })),
		}).then((verdicts) => {
			settled.push('scan');
			return verdicts;
		});

		const run = createTemplateClassificationRun();
		run.pushSignals([
			{ paths: ['news', '1'], stylesheetHrefs: [] },
			{ paths: ['news', '2'], stylesheetHrefs: [] },
		]);
		const classification = run.block().then(() => {
			settled.push('classification');
		});

		const [verdicts] = await Promise.all([scan, classification]);
		run.cancel();

		expect(settled).toEqual(['scan', 'classification']);
		expect(verdicts).toHaveLength(200);
	});
});
