import type { Meta, StoryObj } from '@storybook/react-vite';

import { ConsoleLogType } from './console-log-type.js';

const meta = {
	component: ConsoleLogType,
} satisfies Meta<typeof ConsoleLogType>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An uncaught exception: solid red, the most severe. */
export const PageError: Story = { args: { type: 'pageerror' } };

/** A `console.error` call. */
export const ErrorType: Story = { args: { type: 'error' } };

/** A `console.warn` call. */
export const Warn: Story = { args: { type: 'warn' } };

/** A `console.info` call. */
export const Info: Story = { args: { type: 'info' } };

/** A `console.log` call. */
export const Log: Story = { args: { type: 'log' } };

/** A `console.debug` call. */
export const Debug: Story = { args: { type: 'debug' } };

/** A type the viewer does not know: neutral style, its own name. */
export const Unknown: Story = { args: { type: 'trace' } };

/** Every type side by side, in severity order. */
export const All: Story = {
	args: { type: 'log' },
	render: () => (
		<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
			{['pageerror', 'error', 'warn', 'info', 'log', 'debug', 'trace'].map((type) => (
				<ConsoleLogType key={type} type={type} />
			))}
		</div>
	),
};
