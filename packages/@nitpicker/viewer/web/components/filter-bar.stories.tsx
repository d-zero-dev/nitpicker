import type { Meta, StoryObj } from '@storybook/react-vite';

import { FilterBar } from './filter-bar.js';

const meta = {
	component: FilterBar,
} satisfies Meta<typeof FilterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A few representative filter controls laid out horizontally. */
export const Default: Story = {
	args: {
		children: (
			<>
				<label>
					Status
					<select>
						<option>200</option>
						<option>404</option>
					</select>
				</label>
				<input type="search" placeholder="Filter by URL" />
			</>
		),
	},
};
