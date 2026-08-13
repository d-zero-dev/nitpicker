import type { TemplateClusterLandmarkSummary } from '@nitpicker/query';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { ClusterLandmarkTable } from './cluster-landmark-table.js';

const meta = {
	component: ClusterLandmarkTable,
} satisfies Meta<typeof ClusterLandmarkTable>;

export default meta;
type Story = StoryObj<typeof meta>;

const landmarks: TemplateClusterLandmarkSummary[] = [
	{
		type: 'header',
		presenceRate: 1,
		chromeRate: 0.98,
		memberCountWithInstance: 42,
		shellTokens: ['header>nav', 'header>a.logo'],
		shellTokenCount: 2,
	},
	{
		type: 'nav',
		presenceRate: 0.9,
		chromeRate: 0.2,
		memberCountWithInstance: 38,
		shellTokens: ['nav>ul'],
		shellTokenCount: 1,
	},
];

/** Two landmark types with different chrome-vs-content presence. */
export const Populated: Story = { args: { landmarks } };

/** No landmarks were found common to the block's members: the component returns `null`. */
export const Empty: Story = { args: { landmarks: [] } };
