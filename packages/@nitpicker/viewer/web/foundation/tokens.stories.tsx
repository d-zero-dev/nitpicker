import type { Meta, StoryObj } from '@storybook/react-vite';

/** The design tokens defined on `:root` in `styles.css`: the palette and the font-size scale. */
const meta = {
	title: 'Foundation/Tokens',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const COLOR_TOKENS = [
	'--bg',
	'--bg-elev',
	'--border',
	'--text',
	'--text-dim',
	'--accent',
	'--danger',
	'--success',
	'--warn',
	'--skeleton',
];

const FONT_SIZE_TOKENS = [
	'--font-size-xs',
	'--font-size-sm',
	'--font-size-base',
	'--font-size-md',
	'--font-size-lg',
	'--font-size-xl',
	'--font-size-2xl',
	'--font-size-3xl',
	'--font-size-heading-4',
	'--font-size-heading-3',
	'--font-size-heading-2',
	'--font-size-heading-1',
];

/** The palette; switch the toolbar theme to see the light values. */
export const Colors: Story = {
	render: () => (
		<div
			style={{
				display: 'grid',
				gap: 8,
				gridTemplateColumns: 'repeat(auto-fill, 160px)',
			}}>
			{COLOR_TOKENS.map((token) => (
				<div key={token}>
					<div
						style={{
							blockSize: 48,
							background: `var(${token})`,
							border: '1px solid var(--border)',
							borderRadius: 6,
						}}
					/>
					<code>{token}</code>
				</div>
			))}
		</div>
	),
};

/** The font-size scale, smallest first; body text is `--font-size-md`. */
export const FontSizes: Story = {
	render: () => (
		<table className="plain-table">
			<thead>
				<tr>
					<th>Token</th>
					<th>Sample</th>
				</tr>
			</thead>
			<tbody>
				{FONT_SIZE_TOKENS.map((token) => (
					<tr key={token}>
						<td className="plain-table-nowrap">
							<code>{token}</code>
						</td>
						<td style={{ fontSize: `var(${token})` }}>The quick brown fox 0123456789</td>
					</tr>
				))}
			</tbody>
		</table>
	),
};
