import type { Meta, StoryObj } from '@storybook/react-vite';

/** `button` — the bare element and the shared variants, in each state. */
const meta = {
	title: 'Foundation/Buttons',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The bare `button` with no class. */
export const Bare: Story = {
	render: () => (
		<div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
			<button type="button">Default</button>
			<button type="button" disabled>
				Disabled
			</button>
		</div>
	),
};

/** Every shared variant side by side. */
export const Variants: Story = {
	render: () => (
		<div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
			<button type="button" className="link-button">
				link-button
			</button>
			<button type="button" className="pager-button">
				pager-button
			</button>
			<button type="button" className="icon-button" aria-label="icon-button">
				⚙
			</button>
		</div>
	),
};

/** `.pager-button` in each state: default, current page, disabled. */
export const PagerStates: Story = {
	render: () => (
		<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
			<button type="button" className="pager-button">
				2
			</button>
			<button type="button" className="pager-button pager-number is-current">
				3
			</button>
			<button type="button" className="pager-button" disabled>
				Next
			</button>
		</div>
	),
};
