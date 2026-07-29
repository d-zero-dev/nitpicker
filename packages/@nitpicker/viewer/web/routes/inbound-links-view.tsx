import type { InboundLinkRow } from '../api/use-inbound-links-infinite.js';
import type { InboundLinksResponse } from '../api/use-inbound-links.js';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';

import { useInboundLinksInfinite } from '../api/use-inbound-links-infinite.js';
import { useInboundLinks } from '../api/use-inbound-links.js';
import { DataTable } from '../components/data-table.js';
import { ViewHeader } from '../components/view-header.js';
import { useListPagination } from '../hooks/use-list-pagination.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * Extracts the row window from a response that may be the stub-mode
 * `{ available: false }` marker.
 * @param response - The raw hook response, if loaded yet.
 * @returns The row window, or `[]` while loading or unavailable.
 */
function toItems(response: InboundLinksResponse | undefined): InboundLinkRow[] {
	return response && !('available' in response) ? response.items : [];
}

/**
 * Extracts the total count from a response that may be the stub-mode
 * `{ available: false }` marker.
 * @param response - The raw hook response, if loaded yet.
 * @returns The total count, or `0` while loading or unavailable.
 */
function toTotal(response: InboundLinksResponse | undefined): number {
	return response && !('available' in response) ? response.total : 0;
}

/**
 * The inbound-links view: every referrer page linking to one target page,
 * with anchor text and per-referrer anchor count. Split out of Page Detail
 * (issue #235) — a page's referrer count can reach the hundreds of
 * thousands on a large site, too large to embed in a single-page response.
 * The target URL comes from the `url` query param, same as Page Detail.
 * @returns The inbound-links view element.
 */
export function InboundLinksView() {
	const [params] = useSearchParams();
	const { t } = useI18n();
	const url = params.get('url') ?? '';
	const { mode, pageSize, currentPage, setPage, setPageSize } = useListPagination();

	const offset = (currentPage - 1) * pageSize;
	const paged = useInboundLinks(
		url,
		{ limit: pageSize, offset },
		['inbound-links-paged', url, pageSize, currentPage],
		{ enabled: mode === 'mpa' },
	);
	const infinite = useInboundLinksInfinite(url, { enabled: mode === 'virtual' });
	const infiniteRows = useMemo(
		() => infinite.data?.pages.flatMap((page) => toItems(page)) ?? [],
		[infinite.data],
	);

	const columns = useMemo<ColumnDef<InboundLinkRow>[]>(
		() => [
			{
				id: 'url',
				header: t('views.inboundLinks.colReferrer'),
				size: 420,
				accessorFn: (r) => r.url,
			},
			{
				id: 'textContent',
				header: t('views.inboundLinks.colAnchorText'),
				size: 260,
				accessorFn: (r) => r.textContent ?? '—',
			},
			{
				id: 'count',
				header: t('views.inboundLinks.colCount'),
				size: 90,
				accessorFn: (r) => r.count,
			},
		],
		[t],
	);

	if (!url) {
		return <div className="state">{t('views.pageDetail.noPage')}</div>;
	}

	const currentResponse = mode === 'mpa' ? paged.data : infinite.data?.pages[0];
	const isUnavailable = currentResponse != null && 'available' in currentResponse;

	return (
		<div className="view">
			<ViewHeader
				titleKey="views.inboundLinks.title"
				descriptionKey="views.inboundLinks.description"
			/>
			<Link to={`/pages/detail?url=${encodeURIComponent(url)}`}>
				{t('common.back')} {t('views.pageDetail.title')}
			</Link>
			<dl className="detail-grid">
				<dt>URL</dt>
				<dd>{url}</dd>
			</dl>
			{isUnavailable ? (
				<p className="state">{t('views.inboundLinks.unavailable')}</p>
			) : mode === 'mpa' ? (
				<DataTable
					mode="mpa"
					columns={columns}
					data={toItems(paged.data)}
					total={toTotal(paged.data)}
					currentPage={currentPage}
					pageSize={pageSize}
					onPageChange={setPage}
					onPageSizeChange={setPageSize}
					isFetching={paged.isFetching}
					isLoading={paged.isLoading}
					isError={paged.isError}
					error={paged.error}
				/>
			) : (
				<DataTable
					mode="virtual"
					columns={columns}
					data={infiniteRows}
					total={toTotal(infinite.data?.pages[0])}
					hasNextPage={infinite.hasNextPage}
					isFetching={infinite.isFetching}
					isLoading={infinite.isLoading}
					isError={infinite.isError}
					error={infinite.error}
					onLoadMore={() => {
						void infinite.fetchNextPage();
					}}
				/>
			)}
		</div>
	);
}
