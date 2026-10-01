// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '../i18n/i18n-provider.js';

import { ExternalUrl } from './external-url.js';

describe('ExternalUrl', () => {
	afterEach(cleanup);

	it('renders an http(s) URL as a new-window link with an icon', () => {
		render(
			<I18nProvider initialLocale="en">
				<ExternalUrl url="https://example.com/docs" />
			</I18nProvider>,
		);

		const link = screen.getByRole('link');
		expect(link.getAttribute('href')).toBe('https://example.com/docs');
		expect(link.getAttribute('target')).toBe('_blank');
		expect(link.getAttribute('rel')).toBe('noopener noreferrer');
		expect(link.textContent).toBe('https://example.com/docs');
		expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
			'Opens in a new window',
		);
	});

	it('localizes the icon label', () => {
		render(
			<I18nProvider initialLocale="ja">
				<ExternalUrl url="https://example.com/" />
			</I18nProvider>,
		);

		expect(screen.getByRole('img').getAttribute('aria-label')).toBe('別ウィンドウで開く');
	});

	it.each([
		'javascript:alert(1)',
		'data:text/html,x',
		'mailto:a@example.com',
		'/relative',
	])('renders %s as plain text without a link', (url) => {
		render(
			<I18nProvider initialLocale="en">
				<ExternalUrl url={url} />
			</I18nProvider>,
		);

		expect(screen.queryByRole('link')).toBeNull();
		expect(screen.getByText(url)).toBeTruthy();
	});
});
