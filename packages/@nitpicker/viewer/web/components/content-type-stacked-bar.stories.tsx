import type { ContentTypeCount } from '@nitpicker/query';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { ContentTypeStackedBar } from './content-type-stacked-bar.js';

const meta = {
	component: ContentTypeStackedBar,
} satisfies Meta<typeof ContentTypeStackedBar>;

export default meta;
type Story = StoryObj<typeof meta>;

const mixedEntries: ContentTypeCount[] = [
	{ category: 'html', internal: 300, external: 20 },
	{ category: 'image', internal: 210, external: 0 },
	{ category: 'javascript', internal: 40, external: 5 },
	{ category: 'css', internal: 12, external: 0 },
];

/** Multiple categories with a mixed internal/external split. */
export const Mixed: Story = { args: { entries: mixedEntries } };

/** Every non-HTML category at zero: the bar drops them, the legend keeps them. */
export const HtmlOnly: Story = {
	args: {
		entries: mixedEntries.map((entry) =>
			entry.category === 'html' ? entry : { ...entry, internal: 0, external: 0 },
		),
	},
};

/** Empty input: the component returns `null`. */
export const Empty: Story = { args: { entries: [] } };
