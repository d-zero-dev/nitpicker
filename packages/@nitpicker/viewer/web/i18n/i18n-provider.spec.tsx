// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from './i18n-provider.js';
import { useI18n } from './use-i18n.js';

/**
 *
 */
function LocaleProbe() {
	const { locale } = useI18n();
	return <span>{locale}</span>;
}

describe('I18nProvider', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('uses initialLocale before a persisted browser locale', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => 'en',
			setItem: vi.fn(),
		});

		render(
			<I18nProvider initialLocale="ja">
				<LocaleProbe />
			</I18nProvider>,
		);

		expect(screen.getByText('ja').textContent).toBe('ja');
	});
});
