import type { Meta, StoryObj } from '@storybook/react-vite';

import { SourceBadge } from './source-badge.js';

const meta = {
	component: SourceBadge,
} satisfies Meta<typeof SourceBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The common case: found via the recursive crawl. */
export const Crawled: Story = { args: { source: 'crawled' } };

/** URL was explicitly handed in via `crawl --inventory`. */
export const InventorySeed: Story = { args: { source: 'inventory-seed' } };

/** Found by following links from an inventory-seed page. */
export const InventoryDiscovered: Story = { args: { source: 'inventory-discovered' } };
