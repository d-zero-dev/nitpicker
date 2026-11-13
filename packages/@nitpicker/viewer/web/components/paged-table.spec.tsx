// @vitest-environment jsdom

import type { ColumnDef } from '../types.js';

import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/i18n-provider.js';

import { PagedTable } from './paged-table.js';
import type { TableFilterControl, TableSortControl } from './paged-table.js';

interface Row {
	url: string;
}

const columns: ColumnDef<Row>[] = [{ id: 'url', header: 'URL', accessorKey: 'url' }];

const hidePopover = vi.fn();

/**
 * jsdom implements neither the popover API nor Invoker Commands, so the events a
 * browser fires are dispatched by hand.
 * @param target - The element the browser dispatches the event on.
 * @param type - The event name.
 * @param props - Properties the browser sets on the event.
 */
function dispatch(target: Element, type: string, props: Record<string, unknown>) {
	const event = new Event(type);
	for (const [key, value] of Object.entries(props)) {
		Object.defineProperty(event, key, { value });
	}
	act(() => {
		target.dispatchEvent(event);
	});
}

/**
 * @param controls - Column controls for the `url` column.
 * @param controls.filter - Filter control.
 * @param controls.sort - Sort control.
 */
function renderTable(controls: { filter?: TableFilterControl; sort?: TableSortControl }) {
	render(
		<MemoryRouter>
			<I18nProvider initialLocale="en">
				<PagedTable
					data={[{ url: 'https://example.com/' }]}
					columns={columns}
					total={1}
					currentPage={1}
					pageSize={100}
					onPageChange={vi.fn()}
					onPageSizeChange={vi.fn()}
					isFetching={false}
					columnControls={{
						filter: controls.filter ? { url: controls.filter } : {},
						sort: controls.sort ? { url: controls.sort } : {},
					}}
				/>
			</I18nProvider>
		</MemoryRouter>,
	);
}

/**
 * @param onApply - The apply spy.
 * @returns A checklist filter control with `a` checked and `b` unchecked.
 */
function checklist(onApply = vi.fn()): TableFilterControl {
	return {
		label: 'URL filter',
		kind: 'checklist',
		options: [
			{ value: 'a', label: 'A', checked: true },
			{ value: 'b', label: 'B', checked: false },
		],
		onApply,
	};
}

/**
 * @returns The filter popover element.
 */
function popoverElement() {
	const popover = document.querySelector('.pt-filter-popover');
	if (!popover) {
		throw new Error('no filter popover');
	}
	return popover;
}

/**
 * Opens the popover the way the browser does before showing it.
 */
function openPopover() {
	dispatch(popoverElement(), 'beforetoggle', { newState: 'open' });
}

describe('PagedTable filter popover', () => {
	beforeEach(() => {
		Object.defineProperty(HTMLElement.prototype, 'hidePopover', {
			configurable: true,
			value: hidePopover,
		});
	});

	afterEach(() => {
		cleanup();
		hidePopover.mockClear();
		Reflect.deleteProperty(HTMLElement.prototype, 'hidePopover');
	});

	it('is opened by the F button through the built-in toggle-popover command', () => {
		renderTable({ filter: checklist() });

		const button = screen.getByRole('button', { name: 'URL filter' });

		expect(button.getAttribute('command')).toBe('toggle-popover');
		expect(button.getAttribute('commandfor')).toBe(popoverElement().id);
		expect(popoverElement().getAttribute('popover')).toBe('auto');
	});

	it('renders the options only while open and drops them once closed', () => {
		renderTable({ filter: checklist() });
		expect(popoverElement().querySelectorAll('input')).toHaveLength(0);

		openPopover();
		expect(popoverElement().querySelectorAll('input')).toHaveLength(2);

		dispatch(popoverElement(), 'toggle', { newState: 'closed' });
		expect(popoverElement().querySelectorAll('input')).toHaveLength(0);
	});

	it('starts each open from the current URL-backed state, discarding an unapplied draft', () => {
		renderTable({ filter: checklist() });
		openPopover();
		dispatch(popoverElement(), 'command', { command: '--select-none', source: null });
		expect(popoverElement().querySelectorAll('input:checked')).toHaveLength(0);

		dispatch(popoverElement(), 'toggle', { newState: 'closed' });
		openPopover();

		expect(
			[...popoverElement().querySelectorAll('input')].map((input) => input.checked),
		).toStrictEqual([true, false]);
	});

	it('applies the draft selection and closes on --apply', () => {
		const onApply = vi.fn();
		renderTable({ filter: checklist(onApply) });
		openPopover();

		dispatch(popoverElement(), 'command', { command: '--select-all', source: null });
		dispatch(popoverElement(), 'command', { command: '--apply', source: null });

		expect(onApply).toHaveBeenCalledExactlyOnceWith(['a', 'b']);
		expect(hidePopover).toHaveBeenCalledTimes(1);
	});

	it('selects none, then applies an empty selection', () => {
		const onApply = vi.fn();
		renderTable({ filter: checklist(onApply) });
		openPopover();

		dispatch(popoverElement(), 'command', { command: '--select-none', source: null });
		dispatch(popoverElement(), 'command', { command: '--apply', source: null });

		expect(onApply).toHaveBeenCalledExactlyOnceWith([]);
	});

	it('resets the filter and closes on --reset', () => {
		const onApply = vi.fn();
		renderTable({ filter: checklist(onApply) });
		openPopover();

		dispatch(popoverElement(), 'command', { command: '--reset', source: null });

		expect(onApply).toHaveBeenCalledExactlyOnceWith();
		expect(hidePopover).toHaveBeenCalledTimes(1);
	});
});

describe('PagedTable sort button', () => {
	afterEach(cleanup);

	it.each([
		{ active: false, order: undefined, next: 'asc' },
		{ active: true, order: 'asc' as const, next: 'desc' },
		{ active: true, order: 'desc' as const, next: undefined },
	])('cycles $active/$order to $next on --sort', ({ active, order, next }) => {
		const onChange = vi.fn();
		renderTable({ sort: { active, order, onChange } });
		const button = screen.getByRole('button', { name: 'Sort' });

		expect(button.getAttribute('command')).toBe('--sort');
		expect(button.getAttribute('commandfor')).toBe(button.id);

		dispatch(button, 'command', { command: '--sort', source: button });

		expect(onChange).toHaveBeenCalledExactlyOnceWith(next);
	});
});
