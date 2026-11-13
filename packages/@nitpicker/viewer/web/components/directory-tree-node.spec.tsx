// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/i18n-provider.js';

import { demoDirectoryTreeNode } from './demo-directory-tree-fixtures.js';
import { DirectoryTreeNodeRow } from './directory-tree-node.js';

vi.mock('../api/use-directory-tree-children.js', () => ({
	useDirectoryTreeChildren: () => ({
		data: undefined,
		isLoading: false,
		isError: true,
		error: new Error('children failed to load'),
	}),
}));

const node = demoDirectoryTreeNode({
	nodeId: 2,
	parentNodeId: 1,
	name: 'blog',
	path: '/blog/',
	depth: 1,
	hasChildren: true,
	descendantHtmlPageCount: 20,
});

/**
 * @param onToggle - The toggle spy.
 */
function renderRow(onToggle = vi.fn()) {
	return render(
		<MemoryRouter>
			<I18nProvider initialLocale="en">
				<ul>
					<DirectoryTreeNodeRow
						node={node}
						childrenByParent={new Map()}
						expandedOverrides={new Map([[2, true]])}
						collapseDepthThreshold={3}
						sortOrder="path"
						onToggle={onToggle}
					/>
				</ul>
			</I18nProvider>
		</MemoryRouter>,
	);
}

/**
 * jsdom does not implement Invoker Commands, so a click does not dispatch the
 * `command` event the browser fires at the `commandfor` target (the row).
 * @param target - The element the browser dispatches the event on.
 * @param command - The invoker's `command` attribute value.
 */
function dispatchCommand(target: Element, command: string) {
	const event = new Event('command');
	Object.defineProperty(event, 'command', { value: command });
	target.dispatchEvent(event);
}

describe('DirectoryTreeNodeRow', () => {
	afterEach(cleanup);

	it('links the label to the Pages view filtered to the subtree and HTML documents', () => {
		renderRow();

		const link = screen.getByRole('link', { name: /blog/ });

		expect(link.getAttribute('href')).toBe(
			'/pages?directory=%2Fblog%2F&contentTypeCategory=html',
		);
	});

	it('toggles through a command sent to the row, with the current expanded state', () => {
		const onToggle = vi.fn();
		renderRow(onToggle);
		const toggle = screen.getByRole('button', { name: /collapse/i });
		const row = document.getElementById(toggle.getAttribute('commandfor') ?? '');

		dispatchCommand(row as Element, '--toggle');

		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(onToggle).toHaveBeenCalledExactlyOnceWith(node, true);
	});

	it('shows a failed children load as an alert inside a list item', () => {
		renderRow();

		const alert = screen.getByRole('alert');

		expect(alert.textContent).toBe('children failed to load');
		expect(alert.parentElement?.tagName).toBe('LI');
		expect(alert.parentElement?.getAttribute('role')).toBeNull();
	});
});
