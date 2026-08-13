import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

import { TopBar } from './top-bar.js';

/**
 * Triggers a query that never resolves, so `useIsFetching()` inside
 * `TopBar` reports `> 0` and the header's loading-line indicator renders.
 * @returns Nothing — this component exists only for its `useQuery` call's side effect.
 */
function ForeverPendingQueryTrigger() {
	useQuery({
		queryKey: ['storybook-top-bar-loading-demo'],
		queryFn: () => new Promise<never>(() => {}),
	});
	return null;
}

/**
 * A dedicated `QueryClient` (not the global one from `.storybook/preview.tsx`)
 * so the perpetually-fetching query above doesn't leak `isFetching > 0` into
 * every other story once this one has rendered.
 */
const fetchingQueryClient = new QueryClient();

const withForeverFetching: Decorator = (Story) => (
	<QueryClientProvider client={fetchingQueryClient}>
		<ForeverPendingQueryTrigger />
		<Story />
	</QueryClientProvider>
);

const meta = {
	component: TopBar,
} satisfies Meta<typeof TopBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No props — language/theme toggles and the loading indicator read purely from context. */
export const Default: Story = {};

/** A query is perpetually in flight: the loading line under the top bar is visible. */
export const Fetching: Story = {
	decorators: [withForeverFetching],
};
