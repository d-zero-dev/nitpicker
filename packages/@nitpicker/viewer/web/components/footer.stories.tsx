import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Footer } from './footer.js';

/** Mirrors the private `ArchiveInfo` shape in `use-archive-info.ts`. */
interface ArchiveInfo {
	filePath: string;
	mode: 'archive' | 'stub';
	crawlerPid: number | null;
}

/**
 * `useArchiveInfo()` fetches `/api/info`, which has no server in Storybook.
 * Each story below nests its own `QueryClientProvider` with the archive-info
 * response pre-populated via `setQueryData` — React Query resolves against
 * the nearest provider, so this overrides the global one from
 * `.storybook/preview.tsx` without needing a network mock.
 * @param data - The archive-info response to pre-populate the query cache with.
 * @returns A decorator wrapping the story in a `QueryClientProvider` seeded with `data`.
 */
function withArchiveInfo(data: ArchiveInfo): Decorator {
	const client = new QueryClient();
	client.setQueryData(['archive-info'], data);
	/**
	 * @param Story - The story render function Storybook passes to every decorator.
	 * @returns The story wrapped in the seeded `QueryClientProvider`.
	 */
	function ArchiveInfoDecorator(Story: Parameters<Decorator>[0]) {
		return (
			<QueryClientProvider client={client}>
				<Story />
			</QueryClientProvider>
		);
	}
	return ArchiveInfoDecorator;
}

const meta = {
	component: Footer,
} satisfies Meta<typeof Footer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A finished `.nitpicker` archive file. */
export const Archive: Story = {
	decorators: [
		withArchiveInfo({
			filePath: '/data/example.nitpicker',
			mode: 'archive',
			crawlerPid: null,
		}),
	],
};

/** A live crawl still writing to a stub directory. */
export const LiveCrawlStub: Story = {
	decorators: [
		withArchiveInfo({ filePath: '/data/example-stub', mode: 'stub', crawlerPid: 12_345 }),
	],
};

/** A stub directory left behind by an interrupted (no longer running) crawl. */
export const InterruptedCrawlStub: Story = {
	decorators: [
		withArchiveInfo({ filePath: '/data/example-stub', mode: 'stub', crawlerPid: null }),
	],
};
