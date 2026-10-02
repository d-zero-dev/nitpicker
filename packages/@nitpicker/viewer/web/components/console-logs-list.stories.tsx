import type { PageConsoleLogEntry } from '@nitpicker/query';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { ConsoleLogsList } from './console-logs-list.js';

const meta = {
	component: ConsoleLogsList,
} satisfies Meta<typeof ConsoleLogsList>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Builds one captured entry.
 * @param type - The console type.
 * @param text - The message.
 * @param location - Optional source URL and line.
 * @param location.url - The source file URL.
 * @param location.line - The source line.
 * @param offsetSeconds - Seconds after the base timestamp.
 * @returns The entry.
 */
function entry(
	type: string,
	text: string,
	location: { url: string; line: number } | null,
	offsetSeconds: number,
): PageConsoleLogEntry {
	return {
		type,
		text,
		args: null,
		locationUrl: location?.url ?? null,
		locationLine: location?.line ?? null,
		locationColumn: null,
		stack: null,
		ts: 1_700_000_000_000 + offsetSeconds * 1000,
	};
}

const entries: PageConsoleLogEntry[] = [
	entry(
		'pageerror',
		'Uncaught TypeError: x is not a function',
		{ url: 'https://example.com/app.js', line: 42 },
		0,
	),
	entry(
		'error',
		'Failed to load resource: the server responded with a status of 404',
		{ url: 'https://example.com/missing.png', line: 1 },
		1,
	),
	entry('warn', 'Deprecated API usage', null, 2),
	entry(
		'info',
		'Service worker registered',
		{ url: 'https://example.com/sw.js', line: 7 },
		3,
	),
	entry('log', 'hydrated', null, 4),
	entry('debug', 'render took 12ms', null, 5),
];

/** Every console type, in severity order, some with a source location. */
export const Default: Story = { args: { entries } };

/** A long message wraps inside its cell instead of widening the table. */
export const LongMessage: Story = {
	args: {
		entries: [
			entry(
				'error',
				'A very long console message that keeps going and going so that the wrapping behaviour of the message cell is visible: it breaks inside the column rather than pushing the table wider than its container, however long the text gets.',
				{ url: 'https://example.com/app.js', line: 1024 },
				0,
			),
		],
	},
};

/** Empty input: the component returns `null`. */
export const Empty: Story = { args: { entries: [] } };
