import type { Meta, StoryObj } from '@storybook/react-vite';

/** Form controls as bare elements: `input`, `select`, `textarea`, checkbox and radio, with their `label`s. */
const meta = {
	title: 'Foundation/Forms',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Text-like controls. */
export const TextControls: Story = {
	render: () => (
		<div style={{ display: 'grid', gap: 12, maxInlineSize: 360 }}>
			<label>
				Text input <input type="text" defaultValue="https://example.com/" />
			</label>
			<label>
				Number input <input type="number" defaultValue={100} />
			</label>
			<label>
				Select{' '}
				<select defaultValue="100">
					<option value="50">50</option>
					<option value="100">100</option>
					<option value="200">200</option>
				</select>
			</label>
			<label>
				Textarea <textarea rows={3} defaultValue="Multi-line text" />
			</label>
		</div>
	),
};

/** Checkbox and radio. */
export const Choices: Story = {
	render: () => (
		<div style={{ display: 'grid', gap: 8 }}>
			<label>
				<input type="checkbox" defaultChecked /> Checked
			</label>
			<label>
				<input type="checkbox" /> Unchecked
			</label>
			<label>
				<input type="radio" name="sample" defaultChecked /> Radio A
			</label>
			<label>
				<input type="radio" name="sample" /> Radio B
			</label>
		</div>
	),
};

/** Disabled controls. */
export const Disabled: Story = {
	render: () => (
		<div style={{ display: 'grid', gap: 12, maxInlineSize: 360 }}>
			<input type="text" defaultValue="Disabled input" disabled />
			<select disabled>
				<option>Disabled select</option>
			</select>
		</div>
	),
};
