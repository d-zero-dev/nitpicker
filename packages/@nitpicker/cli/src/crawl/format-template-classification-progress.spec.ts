import { describe, it, expect } from 'vitest';

import { formatTemplateClassificationProgress } from './format-template-classification-progress.js';

describe('formatTemplateClassificationProgress', () => {
	it('renders page loading with a done/total percentage', () => {
		expect(
			formatTemplateClassificationProgress({
				phase: 'loading-pages',
				done: 250,
				total: 500,
			}),
		).toBe('loading 250/500 pages (50%)');
	});

	it('announces the multi-second steps that have no count', () => {
		expect(formatTemplateClassificationProgress({ phase: 'loading-pages-start' })).toBe(
			'loading pages',
		);
		expect(
			formatTemplateClassificationProgress({ phase: 'collecting-stylesheets' }),
		).toBe('collecting stylesheet references');
		expect(
			formatTemplateClassificationProgress({
				phase: 'writing-results',
				templateCount: 1200,
			}),
		).toBe('saving 1,200 template(s)');
	});

	it('renders the pass-0 signal sweep count-only', () => {
		expect(
			formatTemplateClassificationProgress({ phase: 'pass0-signals', pagesSeen: 1200 }),
		).toBe('reading pages (1,200)');
	});

	it('renders block completion with a done/total percentage', () => {
		expect(
			formatTemplateClassificationProgress({
				phase: 'pass1-block-complete',
				blockKey: 'block-1',
				blocksProcessed: 3,
				totalBlocks: 12,
			}),
		).toBe('3/12 blocks (25%)');
	});

	it('renders page assignment with a done/total percentage', () => {
		expect(
			formatTemplateClassificationProgress({
				phase: 'pass1b-assign',
				pagesAssigned: 10,
				pagesToAssign: 40,
			}),
		).toBe('assigning 10/40 pages (25%)');
	});

	it('renders the stage-B merge start count-only', () => {
		expect(
			formatTemplateClassificationProgress({ phase: 'stage-b-start', unitCount: 7 }),
		).toBe('merging 7 units');
	});

	it('never embeds animation placeholders (the TaskList icon is the spinner)', () => {
		const message = formatTemplateClassificationProgress({
			phase: 'loading-pages',
			done: 1,
			total: 2,
		});
		expect(message).not.toMatch(/%braille%|%dots%/);
	});
});
