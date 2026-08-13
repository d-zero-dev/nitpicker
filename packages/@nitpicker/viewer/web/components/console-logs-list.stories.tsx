import type { PageConsoleLogEntry } from '@nitpicker/query';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { ConsoleLogsList } from './console-logs-list.js';

const meta = {
	component: ConsoleLogsList,
} satisfies Meta<typeof ConsoleLogsList>;

export default meta;
type Story = StoryObj<typeof meta>;

const entries: PageConsoleLogEntry[] = [
	{
		type: 'error',
		text: 'Uncaught TypeError: x is not a function',
		args: null,
		locationUrl: 'https://example.com/app.js',
		locationLine: 42,
		locationColumn: 3,
		stack: null,
		ts: 1_700_000_000_000,
	},
	{
		type: 'warning',
		text: 'Deprecated API usage',
		args: null,
		locationUrl: null,
		locationLine: null,
		locationColumn: null,
		stack: null,
		ts: 1_700_000_001_000,
	},
];

/** A page with a mix of console errors and warnings, some with source location. */
export const Default: Story = { args: { entries } };

/** Empty input: the component returns `null`. */
export const Empty: Story = { args: { entries: [] } };
