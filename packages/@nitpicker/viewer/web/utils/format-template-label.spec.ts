import type { I18nValue } from '../types.js';

import { describe, expect, it } from 'vitest';

import { formatTemplateLabel } from './format-template-label.js';

/**
 * A translate stub with the two label templates, interpolating `{name}` placeholders.
 * @returns A translate function compatible with {@link formatTemplateLabel}.
 */
function tStub(): I18nValue['t'] {
	const dictionary: Record<string, string> = {
		'views.templateLabel.sectioned': '{section} template {letter}',
		'views.templateLabel.siteWide': 'template {letter}',
	};
	return ((key: string, vars?: Record<string, string | number>) =>
		(dictionary[key] ?? key).replaceAll(/\{(\w+)\}/g, (_, name: string) =>
			String(vars?.[name] ?? ''),
		)) as I18nValue['t'];
}

describe('formatTemplateLabel', () => {
	it('renders a sectioned label as "<section> template <letter>"', () => {
		expect(formatTemplateLabel({ section: 'events', ordinal: 2 }, tStub())).toBe(
			'events template B',
		);
	});

	it('renders a site-wide label without a section', () => {
		expect(formatTemplateLabel({ section: null, ordinal: 27 }, tStub())).toBe(
			'template AA',
		);
	});
});
