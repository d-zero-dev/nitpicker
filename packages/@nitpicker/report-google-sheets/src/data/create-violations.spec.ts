import type { Report } from '@nitpicker/types';

import { describe, it, expect } from 'vitest';

import { createViolations } from './create-violations.js';

describe('createViolations', () => {
	it('returns sheet config with name "Violations"', () => {
		const sheet = createViolations([]);
		expect(sheet.name).toBe('Violations');
	});

	it('returns correct headers', () => {
		const sheet = createViolations([]);
		const headers = sheet.createHeaders();
		expect(headers).toEqual(['Validator', 'Severity', 'Rule', 'Code', 'Message', 'URL']);
	});

	it('generates rows from report violations', () => {
		const reports: Report[] = [
			{
				name: 'axe',
				violations: [
					{
						validator: 'axe',
						severity: 'serious',
						rule: 'color-contrast',
						code: 'color-contrast',
						message: 'Elements must have sufficient color contrast',
						url: 'https://example.com/',
					},
				],
			},
		];

		const sheet = createViolations(reports);
		const rows = sheet.addRows!();

		expect(rows).toHaveLength(1);
		expect(rows[0]).toHaveLength(6);
	});

	it('skips reports without violations', () => {
		const reports: Report[] = [{ name: 'no-violations' }];

		const sheet = createViolations(reports);
		const rows = sheet.addRows!();

		expect(rows).toHaveLength(0);
	});

	it('handles multiple reports with multiple violations', () => {
		const reports: Report[] = [
			{
				name: 'axe',
				violations: [
					{
						validator: 'axe',
						severity: 'serious',
						rule: 'rule-1',
						code: 'code-1',
						message: 'msg-1',
						url: 'https://example.com/a',
					},
					{
						validator: 'axe',
						severity: 'minor',
						rule: 'rule-2',
						code: 'code-2',
						message: 'msg-2',
						url: 'https://example.com/b',
					},
				],
			},
			{
				name: 'markuplint',
				violations: [
					{
						validator: 'markuplint',
						severity: 'warning',
						rule: 'rule-3',
						code: 'code-3',
						message: 'msg-3',
						url: 'https://example.com/c',
					},
				],
			},
		];

		const sheet = createViolations(reports);
		const rows = sheet.addRows!();

		expect(rows).toHaveLength(3);
	});
});
