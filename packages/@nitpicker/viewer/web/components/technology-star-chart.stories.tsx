import type { Meta, StoryObj } from '@storybook/react-vite';

import { TechnologyStarChart } from './technology-star-chart.js';

const meta = {
	component: TechnologyStarChart,
} satisfies Meta<typeof TechnologyStarChart>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Two detected technologies, confidence descending. Click a row to expand
 * its contributing signals.
 */
export const Default: Story = {
	args: {
		data: {
			technologies: [
				{
					technology: 'Next.js',
					category: 'JavaScript frameworks',
					version: null,
					confidence: 80,
					signalCount: 2,
					signals: [
						{ signalType: 'html-marker', evidence: '__NEXT_DATA__', weight: 70 },
						{ signalType: 'url-pattern', evidence: '/_next/', weight: 50 },
					],
				},
				{
					technology: 'Google Tag Manager',
					category: 'Analytics',
					version: null,
					confidence: 60,
					signalCount: 1,
					signals: [{ signalType: 'wappalyzer', evidence: 'GTM-XXXX', weight: 60 }],
				},
			],
		},
		isLoading: false,
		error: null,
	},
};

/** No technology detected on this page. */
export const Empty: Story = {
	args: { data: { technologies: [] }, isLoading: false, error: null },
};

/** The technologies query is still loading. */
export const Loading: Story = { args: { data: undefined, isLoading: true, error: null } };

/**
 * The technologies query failed.
 *
 * Built via `globalThis.Error`, not a bare `new Error(...)` — this story
 * is itself named `Error`, and referencing the bare identifier inside its
 * own initializer would try to read the local `Error` binding before it's
 * assigned (a self-shadowing temporal-dead-zone reference), not the global
 * constructor.
 */
export const Error: Story = {
	args: {
		data: undefined,
		isLoading: false,
		error: new globalThis.Error('Failed to fetch page technologies.'),
	},
};
