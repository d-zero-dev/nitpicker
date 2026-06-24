import type { LinkRow, LinkType } from '../api/use-links-infinite.js';
import type { ColumnDef } from '@tanstack/react-table';

import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';

import { useLinksInfinite } from '../api/use-links-infinite.js';
import { FilterBar } from '../components/filter-bar.js';
import { ViewHeader } from '../components/view-header.js';
import { VirtualTable } from '../components/virtual-table.js';
import { useI18n } from '../i18n/use-i18n.js';

/** Valid link types for the selector. */
const LINK_TYPES: LinkType[] = ['broken', 'external'];

/**
 * Reads a string property from a link row.
 * @param row - The link row.
 * @param key - The property name.
 * @returns The stringified value, or an empty string if absent.
 */
function field(row: LinkRow, key: string): string {
	const value = (row as Record<string, unknown>)[key];
	return value == null ? '' : String(value);
}

/**
 * The link analysis view: broken or external links in a virtualised table.
 *
 * The previous `'orphaned'` chip was retired together with
 * `listLinks type:'orphaned'`. Complete singleton inventory-* pages now
 * live in the **孤立ページ** view, and interconnected orphan groups in the
 * **孤立集合** view — the two well-separated concepts that the old single
 * `'orphaned'` bucket conflated.
 * @returns The links view element.
 */
export function LinksView() {
	const [params, setParams] = useSearchParams();
	const { t } = useI18n();
	const rawType = params.get('type') as LinkType | null;
	const type: LinkType =
		rawType !== null && LINK_TYPES.includes(rawType) ? rawType : 'broken';

	// If the URL was visited with a now-removed `type` (e.g. a bookmarked
	// `?type=orphaned` from before the retirement of that filter), surface
	// the coercion in the URL bar so the shown rows stay consistent with
	// what the address says. Otherwise the table would render `broken`
	// rows under a `type=orphaned` URL — a silent data-meaning swap that
	// confuses sharing/handoff.
	useEffect(() => {
		if (rawType !== null && !LINK_TYPES.includes(rawType)) {
			const next = new URLSearchParams(params);
			next.set('type', type);
			setParams(next, { replace: true });
		}
	}, [rawType, type, params, setParams]);

	const { data, fetchNextPage, hasNextPage, isFetching, isLoading } =
		useLinksInfinite(type);
	const rows = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
	const total = data?.pages[0]?.total ?? 0;

	const columns = useMemo<ColumnDef<LinkRow>[]>(
		() => [
			{
				id: 'sourceUrl',
				header: t('views.links.colSource'),
				size: 380,
				accessorFn: (r) => field(r, 'sourceUrl'),
			},
			{
				id: 'destUrl',
				header: t('views.links.colDest'),
				size: 380,
				accessorFn: (r) => field(r, 'destUrl'),
			},
			{
				id: 'status',
				header: t('views.links.colStatus'),
				size: 90,
				accessorFn: (r) => field(r, 'status') || '—',
			},
		],
		[t],
	);

	return (
		<div className="view">
			<ViewHeader titleKey="views.links.title" descriptionKey="views.links.description" />
			<FilterBar>
				<select
					aria-label={t('common.type')}
					value={type}
					onChange={(e) => {
						const next = new URLSearchParams(params);
						next.set('type', e.target.value);
						setParams(next);
					}}>
					{LINK_TYPES.map((linkType) => (
						<option key={linkType} value={linkType}>
							{t(`views.links.${linkType}`)}
						</option>
					))}
				</select>
			</FilterBar>
			<VirtualTable
				data={rows}
				columns={columns}
				total={total}
				hasNextPage={hasNextPage}
				isFetching={isFetching}
				isLoading={isLoading}
				onLoadMore={() => {
					void fetchNextPage();
				}}
			/>
		</div>
	);
}
