import type { Meta, StoryObj } from '@storybook/react-vite';

import { ButtonList } from './button-list.js';

const meta = {
	component: ButtonList,
} satisfies Meta<typeof ButtonList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A mix of button-like elements, one disabled. */
export const Default: Story = {
	args: {
		buttons: [
			{ nodeName: 'BUTTON', role: null, type: 'submit', text: 'Submit', disabled: false },
			{ nodeName: 'A', role: 'button', type: null, text: 'Learn more', disabled: false },
			{ nodeName: 'INPUT', role: null, type: 'button', text: null, disabled: true },
		],
	},
};

/** Empty input: the component returns `null`. */
export const Empty: Story = { args: { buttons: [] } };
