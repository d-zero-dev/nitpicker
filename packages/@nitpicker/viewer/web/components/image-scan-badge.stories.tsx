import type { Meta, StoryObj } from '@storybook/react-vite';

import { ImageScanBadge } from './image-scan-badge.js';

const meta = {
	component: ImageScanBadge,
} satisfies Meta<typeof ImageScanBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The common case: the scan completed normally. */
export const Ok: Story = { args: { outcome: 'ok' } };

/** Network never went idle, but the frame stayed usable — data was still collected. */
export const Degraded: Story = { args: { outcome: 'degraded' } };

/** Network never settled and the post-timeout frame check also failed. */
export const NavUnsettled: Story = { args: { outcome: 'nav-unsettled' } };

/** The frame or session was lost mid-scan. */
export const FrameLost: Story = { args: { outcome: 'frame-lost' } };

/** `scrollHeight` exceeded the scan's guard; a deterministic, non-retryable outcome. */
export const ScrollHeightExceeded: Story = {
	args: { outcome: 'scroll-height-exceeded' },
};

/** An error occurred that does not match any known category. */
export const Unknown: Story = { args: { outcome: 'unknown' } };

/** No scan was ever attempted for this viewport — renders nothing. */
export const NotAttempted: Story = { args: { outcome: null } };
