// @vitest-environment jsdom

import type { CommandHandlers } from '../types.js';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCommandTarget } from './use-command-target.js';

/**
 * jsdom does not implement Invoker Commands, so a click on a `command`
 * button dispatches nothing. Dispatch the `command` event the browser would
 * fire on the `commandfor` target.
 * @param target - The element the browser dispatches the event on.
 * @param command - The invoker's `command` attribute value.
 * @param source - The invoker button.
 */
function dispatchCommand(target: Element, command: string, source: Element | null) {
	const event = new Event('command');
	Object.defineProperties(event, {
		command: { value: command },
		source: { value: source },
	});
	target.dispatchEvent(event);
}

/**
 * @param props - Harness props.
 * @param props.handlers - Forwarded to the hook.
 */
function Harness(props: { handlers: CommandHandlers }) {
	const { id, ref } = useCommandTarget<HTMLDivElement>(props.handlers);
	return (
		<div ref={ref} id={id} data-testid="target">
			<button type="button" command="--go" commandfor={id} value="3">
				go
			</button>
		</div>
	);
}

/**
 * A harness whose target element is rendered conditionally and can change its tag.
 * @param props - Harness props.
 * @param props.handlers - Forwarded to the hook.
 * @param props.show - Whether the target is rendered.
 * @param props.tag - The target's element name; a different one remounts it.
 */
function LateHarness(props: {
	handlers: CommandHandlers;
	show: boolean;
	tag?: 'div' | 'section';
}) {
	const { id, ref } = useCommandTarget<HTMLElement>(props.handlers);
	if (!props.show) {
		return null;
	}
	return props.tag === 'section' ? (
		<section ref={ref} id={id} data-testid="target" />
	) : (
		<div ref={ref as React.RefObject<HTMLDivElement>} id={id} data-testid="target" />
	);
}

describe('useCommandTarget', () => {
	afterEach(cleanup);

	it('returns an id that is set on the element the ref points to', () => {
		render(<Harness handlers={{}} />);

		const target = screen.getByTestId('target');
		expect(target.id).not.toBe('');
		expect(screen.getByRole('button').getAttribute('commandfor')).toBe(target.id);
	});

	it('calls the handler registered for the dispatched command with the event', () => {
		const go = vi.fn();
		render(<Harness handlers={{ '--go': go }} />);

		const button = screen.getByRole('button');
		dispatchCommand(screen.getByTestId('target'), '--go', button);

		expect(go).toHaveBeenCalledTimes(1);
		const event = go.mock.calls[0]?.[0] as CommandEvent;
		expect(event.command).toBe('--go');
		expect((event.source as HTMLButtonElement).value).toBe('3');
	});

	it('ignores a command that has no handler', () => {
		const go = vi.fn();
		render(<Harness handlers={{ '--go': go }} />);

		dispatchCommand(screen.getByTestId('target'), '--other', null);

		expect(go).not.toHaveBeenCalled();
	});

	it('calls the latest handlers after a re-render', () => {
		const first = vi.fn();
		const second = vi.fn();
		const { rerender } = render(<Harness handlers={{ '--go': first }} />);
		rerender(<Harness handlers={{ '--go': second }} />);

		dispatchCommand(screen.getByTestId('target'), '--go', null);

		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
	});

	it('wires a target that is mounted after the first render', () => {
		const go = vi.fn();
		const { rerender } = render(<LateHarness handlers={{ '--go': go }} show={false} />);
		expect(screen.queryByTestId('target')).toBeNull();

		rerender(<LateHarness handlers={{ '--go': go }} show />);
		dispatchCommand(screen.getByTestId('target'), '--go', null);

		expect(go).toHaveBeenCalledTimes(1);
	});

	it('moves the listener to a replaced element and drops the old one', () => {
		const go = vi.fn();
		const { rerender } = render(<LateHarness handlers={{ '--go': go }} show tag="div" />);
		const before = screen.getByTestId('target');

		rerender(<LateHarness handlers={{ '--go': go }} show tag="section" />);
		const after = screen.getByTestId('target');
		expect(before).not.toBe(after);

		dispatchCommand(after, '--go', null);
		expect(go).toHaveBeenCalledTimes(1);

		dispatchCommand(before, '--go', null);
		expect(go).toHaveBeenCalledTimes(1);
	});

	it('stops listening when the element unmounts', () => {
		const go = vi.fn();
		const { unmount } = render(<Harness handlers={{ '--go': go }} />);
		const target = screen.getByTestId('target');

		unmount();
		dispatchCommand(target, '--go', null);

		expect(go).not.toHaveBeenCalled();
	});
});
