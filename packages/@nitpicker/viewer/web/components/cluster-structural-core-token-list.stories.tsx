import type { Meta, StoryObj } from '@storybook/react-vite';

import { ClusterStructuralCoreTokenList } from './cluster-structural-core-token-list.js';

const meta = {
	component: ClusterStructuralCoreTokenList,
} satisfies Meta<typeof ClusterStructuralCoreTokenList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** All found tokens fit within the transported list — no truncation note. */
export const Full: Story = {
	args: {
		tokens: ['html>body>header', 'html>body>main', 'html>body>footer'],
		hiddenCount: 0,
	},
};

/** The reason summary truncated the token list — the "N more" note shows. */
export const Truncated: Story = {
	args: { tokens: ['html>body>header', 'html>body>main'], hiddenCount: 12 },
};

/** No shared structural core was found across the block's members. */
export const Empty: Story = { args: { tokens: [], hiddenCount: 0 } };
