import type { Meta, StoryObj } from '@storybook/react-vite';

import { PropertyList } from './property-list.js';

const meta = {
	component: PropertyList,
} satisfies Meta<typeof PropertyList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		items: [
			{ label: 'Clusters', value: 3 },
			{ label: 'Pages', value: 128 },
		],
	},
};

/** A value may be any node, e.g. a list of paths. */
export const WithRichValue: Story = {
	args: {
		items: [
			{ label: 'Pages', value: 128 },
			{
				label: 'Related paths',
				value: (
					<>
						<code>/news/</code> <code>/docs/</code>
					</>
				),
			},
		],
	},
};
