import type { CommandHandlers } from '../types.js';
import type { RefObject } from 'react';

import { useEffect, useId, useRef } from 'react';

/**
 * Makes an element the `commandfor` target of Invoker Commands buttons.
 *
 * A `<button command="--name" commandfor={id}>` fires a `command` event at
 * the element with that id when it is activated (click, Enter, Space), so
 * state updates need no `onClick` handler. The element receives the event
 * here and dispatches by `event.command`. A command cannot carry a value:
 * put it in the button's `value` attribute and read it from
 * `event.source`.
 *
 * `handlers` may change on every render; the latest one is always called.
 * A command with no handler is ignored, and several buttons may share one
 * target (give each its own `command`).
 *
 * The target must carry both the returned `ref` and `id`; a target missing
 * either silently does nothing. It may mount after the first render or be
 * replaced by another element: the listener follows `ref.current`.
 *
 * Requires a browser with Invoker Commands (Chrome/Edge 135, Firefox 144,
 * Safari 26.2). There is no polyfill: on an older browser the button does
 * nothing.
 * @param handlers - Handler per custom command name.
 * @returns The `id` to pass as `commandfor` and the `ref` to attach to the
 * target element (which must also receive that `id`).
 * @example
 * ```tsx
 * function Counter() {
 * 	const [count, setCount] = useState(0);
 * 	const { id, ref } = useCommandTarget<HTMLDivElement>({
 * 		'--increment': () => setCount((value) => value + 1),
 * 	});
 * 	return (
 * 		<div ref={ref} id={id}>
 * 			<button type="button" command="--increment" commandfor={id}>
 * 				{count}
 * 			</button>
 * 		</div>
 * 	);
 * }
 * ```
 */
export function useCommandTarget<T extends HTMLElement>(
	handlers: CommandHandlers,
): { id: string; ref: RefObject<T | null> } {
	const id = useId();
	const ref = useRef<T | null>(null);
	const latest = useRef(handlers);
	latest.current = handlers;

	// `ref.current` can change on any render (the target mounts late, or its element is
	// replaced), so this effect runs after every render and re-wires only when the element
	// differs from the one already wired.
	const wired = useRef<{ element: T; unwire: () => void } | null>(null);
	useEffect(() => {
		const element = ref.current;
		if (wired.current?.element === element) {
			return;
		}
		wired.current?.unwire();
		wired.current = null;
		if (!element) {
			return;
		}
		const listener = (event: Event) => {
			const commandEvent = event as CommandEvent;
			const handler = latest.current[commandEvent.command as `--${string}`];
			handler?.(commandEvent);
		};
		element.addEventListener('command', listener);
		wired.current = {
			element,
			unwire: () => {
				element.removeEventListener('command', listener);
			},
		};
	});
	useEffect(
		() => () => {
			wired.current?.unwire();
			wired.current = null;
		},
		[],
	);

	return { id, ref };
}
