// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '../i18n/i18n-provider.js';

import { HtmlPreview } from './html-preview.js';

/**
 * jsdom does not implement Invoker Commands, so a click does not dispatch the
 * `command` event the browser fires at the `commandfor` target (the toolbar).
 * @param target - The element the browser dispatches the event on.
 * @param command - The invoker's `command` attribute value.
 */
function dispatchCommand(target: Element, command: string) {
	const event = new Event('command');
	Object.defineProperty(event, 'command', { value: command });
	act(() => {
		target.dispatchEvent(event);
	});
}

describe('HtmlPreview', () => {
	afterEach(cleanup);

	it('shows the sandboxed rendered view first, without lazy loading', () => {
		const { container } = render(
			<I18nProvider initialLocale="en">
				<HtmlPreview html="<p>hi</p>" truncated={false} />
			</I18nProvider>,
		);

		const frame = container.querySelector('iframe');

		expect(frame?.getAttribute('sandbox')).toBe('');
		expect(frame?.getAttribute('srcdoc')).toBe('<p>hi</p>');
		expect(frame?.hasAttribute('loading')).toBe(false);
		expect(container.querySelector('.hp-source')).toBeNull();
	});

	it('switches between the rendered view and the source with --source / --render', () => {
		const { container } = render(
			<I18nProvider initialLocale="en">
				<HtmlPreview html="<p>hi</p>" truncated={false} />
			</I18nProvider>,
		);
		const source = screen.getByRole('button', { name: 'Source' });
		const toolbar = document.getElementById(source.getAttribute('commandfor') ?? '');
		if (!toolbar) {
			throw new Error('no toolbar');
		}

		dispatchCommand(toolbar, '--source');
		expect(container.querySelector('.hp-source')?.textContent).toBe('<p>hi</p>');
		expect(container.querySelector('iframe')).toBeNull();

		dispatchCommand(toolbar, '--render');
		expect(container.querySelector('iframe')).not.toBeNull();
		expect(container.querySelector('.hp-source')).toBeNull();
	});

	it('marks the active tab', () => {
		const { container } = render(
			<I18nProvider initialLocale="en">
				<HtmlPreview html="x" truncated />
			</I18nProvider>,
		);

		expect(container.querySelector('.hp-tab-active')?.textContent).toBe('Render');
		expect(container.querySelector('.hp-truncated')).not.toBeNull();
	});
});
