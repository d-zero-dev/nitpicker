import type { Meta, StoryObj } from '@storybook/react-vite';

/**
 * `button` — the bare element and the shared variants, in each state.
 *
 * The demo buttons carry `command="--demo"` only because Markuplint requires
 * every `type="button"` button to have a `command`; no element receives it.
 * That is acceptable for these static foundation samples only: a button in the
 * app must send a command to an element that handles it (`useCommandTarget`).
 */
const meta = {
	title: 'Foundation/Buttons',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The bare `button` with no class. */
export const Bare: Story = {
	render: () => (
		<div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
			<button type="button" command="--demo">
				Default
			</button>
			<button type="button" command="--demo" disabled>
				Disabled
			</button>
		</div>
	),
};

/** Every shared variant side by side. */
export const Variants: Story = {
	render: () => (
		<div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
			{/* In the app `.link-button` is on an `AppLink` (`<a>`), not a button. */}
			<a href="/" className="link-button">
				link-button
			</a>
			<button type="button" command="--demo" className="pager-button">
				pager-button
			</button>
			{/* The glyph is no useful name, so `aria-label` overrides it on purpose;
			    `.markuplintrc.json` exempts `button.icon-button` from
			    `no-redundant-accessible-name` for static content like this. */}
			<button
				type="button"
				command="--demo"
				className="icon-button"
				aria-label="icon-button">
				⚙
			</button>
		</div>
	),
};

/** `.pager-button` as the Pager renders it: a link, the current page (`span`), and a disabled link. */
export const PagerStates: Story = {
	render: () => (
		<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
			<a href="/?page=2" className="pager-button">
				2
			</a>
			<span className="pager-button pager-number is-current" aria-current="page">
				3
			</span>
			<span role="link" aria-disabled="true" className="pager-button">
				Next
			</span>
		</div>
	),
};
