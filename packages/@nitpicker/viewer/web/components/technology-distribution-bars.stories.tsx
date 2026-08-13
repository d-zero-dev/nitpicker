import type { Meta, StoryObj } from '@storybook/react-vite';

import { MemoryRouter } from 'react-router';

import { TechnologyDistributionBars } from './technology-distribution-bars.js';

const meta = {
	component: TechnologyDistributionBars,
	decorators: [
		(Story) => (
			<MemoryRouter>
				<Story />
			</MemoryRouter>
		),
	],
} satisfies Meta<typeof TechnologyDistributionBars>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A typical mixed stack, page count descending. */
export const Default: Story = {
	args: {
		technologyDistribution: [
			{ technology: 'Next.js', pageCount: 80 },
			{ technology: 'Vue', pageCount: 20 },
			{ technology: 'Google Tag Manager', pageCount: 95 },
		],
		internalPages: 100,
	},
};

/** No technology detected anywhere in the archive: renders nothing. */
export const Empty: Story = { args: { technologyDistribution: [], internalPages: 100 } };
