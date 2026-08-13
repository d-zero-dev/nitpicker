import type { Meta, StoryObj } from '@storybook/react-vite';

import { DiffCell } from './diff-cell.js';

const meta = {
	component: DiffCell,
} satisfies Meta<typeof DiffCell>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A middle segment differs: removed (red) then added (green). */
export const Default: Story = {
	args: {
		segments: [
			{ value: 'The page ', type: 'common' },
			{ value: 'title', type: 'removed' },
			{ value: 'heading', type: 'added' },
			{ value: ' is missing', type: 'common' },
		],
	},
};

/** No differences: every segment is common. */
export const NoDiff: Story = {
	args: { segments: [{ value: 'Identical text', type: 'common' }] },
};
