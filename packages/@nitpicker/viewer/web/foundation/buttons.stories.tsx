import type { Meta, StoryObj } from '@storybook/react-vite';

/** Button variants defined in the global stylesheet. */
const meta = {
	title: 'Foundation/Buttons',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** `button` in each shared variant, next to a plain link for comparison. */
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
			<a href="https://example.com/">anchor</a>
		</div>
	),
};
