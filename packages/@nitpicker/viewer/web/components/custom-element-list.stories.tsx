import type { Meta, StoryObj } from '@storybook/react-vite';

import { CustomElementList } from './custom-element-list.js';

const meta = {
	component: CustomElementList,
} satisfies Meta<typeof CustomElementList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A couple of Web Components with different id/class combinations. */
export const Default: Story = {
	args: {
		customElements: [
			{ nodeName: 'MY-WIDGET', elementId: 'widget-1', classList: ['foo', 'bar'] },
			{ nodeName: 'X-TABS', elementId: null, classList: [] },
		],
	},
};

/** Empty input: the component returns `null`. */
export const Empty: Story = { args: { customElements: [] } };
