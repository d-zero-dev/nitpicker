import type { Meta, StoryObj } from '@storybook/react-vite';

import { ExternalUrl } from './external-url.js';

const meta = {
	component: ExternalUrl,
} satisfies Meta<typeof ExternalUrl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: { url: 'https://example.com/docs/getting-started' },
};

/** Non-HTTP(S) values are never made followable. */
export const NotHttp: Story = {
	args: { url: 'javascript:void(0)' },
};

export const LongUrl: Story = {
	args: {
		url: 'https://example.com/a/very/long/path/that/keeps/going/and/going/to/check/wrapping?query=value&another=value',
	},
};
