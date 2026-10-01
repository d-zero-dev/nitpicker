import type { I18nValue } from '../types.js';
import type { TemplateClusterSummary } from '@nitpicker/query';

import { describe, expect, it } from 'vitest';

import { formatClusterName } from './format-cluster-name.js';

const t = ((key: string, vars?: Record<string, string | number>) =>
	key === 'views.templateLabel.sectioned'
		? `${vars?.section} template ${vars?.letter}`
		: key === 'views.templateLabel.siteWide'
			? `template ${vars?.letter}`
			: key) as I18nValue['t'];

const base: TemplateClusterSummary = {
	templateKey: '["css:abc","cluster:0"]',
	label: null,
	pageCount: 3,
	commonDirectories: [{ directory: 'https://example.com/events/', pageCount: 3 }],
	commonStylesheetUrls: [],
	commonStylesheetFileNames: ['site.css'],
	reason: null,
};

describe('formatClusterName', () => {
	it('uses the label when the cluster has one', () => {
		expect(
			formatClusterName(
				{ ...base, label: { section: 'events', ordinal: 1, provisional: false } },
				t,
			),
		).toBe('events template A');
	});

	it('uses a provisional label the same way', () => {
		expect(
			formatClusterName(
				{ ...base, label: { section: null, ordinal: 3, provisional: true } },
				t,
			),
		).toBe('template C');
	});

	it('falls back to the member-derived heading without a label', () => {
		expect(formatClusterName(base, t)).toBe('site.css');
	});
});
