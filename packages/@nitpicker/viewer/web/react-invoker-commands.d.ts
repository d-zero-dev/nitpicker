import 'react';

/**
 * `@types/react` does not declare the Invoker Commands attributes of
 * `<button>` (HTML Living Standard). React passes unknown lowercase
 * attributes through to the DOM as written, so only the types are missing.
 */
declare module 'react' {
	interface ButtonHTMLAttributes<T> {
		/** Built-in (`toggle-popover`, …) or custom (`--name`) command to send to the `commandfor` element. */
		command?: string | undefined;
		/** `id` of the element that receives the command. */
		commandfor?: string | undefined;
	}
}
