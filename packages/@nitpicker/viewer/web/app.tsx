import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { Footer } from './components/footer.js';
import { NavSidebar } from './components/nav-sidebar.js';
import { MAIN_CONTENT_ID, SkipLink } from './components/skip-link.js';
import { TopBar } from './components/top-bar.js';
import { I18nProvider } from './i18n/i18n-provider.js';
import { DuplicatesView } from './routes/duplicates-view.js';
import { GraphView } from './routes/graph-view.js';
import { HeadersView } from './routes/headers-view.js';
import { ImagesView } from './routes/images-view.js';
import { LinksView } from './routes/links-view.js';
import { MismatchesView } from './routes/mismatches-view.js';
import { PageDetailView } from './routes/page-detail-view.js';
import { PageLinksView } from './routes/page-links-view.js';
import { PagesView } from './routes/pages-view.js';
import { ResourcesView } from './routes/resources-view.js';
import { SummaryView } from './routes/summary-view.js';
import { ViolationsView } from './routes/violations-view.js';

/** Shared TanStack Query client. Server data is read-only and rarely changes. */
const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			staleTime: 60_000,
		},
	},
});

/**
 * Root application: providers, client-side routing, and the sidebar layout.
 *
 * Uses BrowserRouter (History API) for clean URLs (`/pages`, not `/#/pages`).
 * The Hono backend serves `index.html` for unmatched GETs, so deep links and
 * reloads resolve correctly; a future Electron shell loads the same app from
 * the local server.
 * @returns The application element.
 */
export function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<I18nProvider>
				<BrowserRouter>
					<div className="app-shell">
						<SkipLink />
						<TopBar />
						<div className="layout">
							<NavSidebar />
							<main className="content" id={MAIN_CONTENT_ID} tabIndex={-1}>
								<Routes>
									<Route path="/" element={<SummaryView />} />
									<Route path="/pages" element={<PagesView />} />
									<Route path="/pages/detail" element={<PageDetailView />} />
									<Route path="/resources" element={<ResourcesView />} />
									<Route path="/images" element={<ImagesView />} />
									<Route path="/links" element={<LinksView />} />
									<Route path="/page-links" element={<PageLinksView />} />
									<Route path="/graph" element={<GraphView />} />
									<Route path="/violations" element={<ViolationsView />} />
									<Route path="/duplicates" element={<DuplicatesView />} />
									<Route path="/mismatches" element={<MismatchesView />} />
									<Route path="/headers" element={<HeadersView />} />
									<Route path="*" element={<Navigate to="/" replace />} />
								</Routes>
							</main>
						</div>
						<Footer />
					</div>
				</BrowserRouter>
			</I18nProvider>
		</QueryClientProvider>
	);
}
