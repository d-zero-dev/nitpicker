import type { LinkRow, LinkType } from '../api/use-links-infinite.js';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';
import { useSearchParams } from 'react-router';

import { useLinksInfinite } from '../api/use-links-infinite.js';
import { FilterBar } from '../components/filter-bar.js';
import { ViewHeader } from '../components/view-header.js';
import { VirtualTable } from '../components/virtual-table.js';
import { useI18n } from '../i18n/use-i18n.js';

/** Valid link types for the selector. */
const LINK_TYPES: LinkType[] = ['broken', 'external', 'orphaned'];

/**
 * Reads a string property from a link row regardless of which union member it is.
 * @param row - The link row.
 * @param key - The property name.
 * @returns The stringified value, or an empty string if absent.
 */
function field(row: LinkRow, key: string): string {
	const value = (row as Record<string, unknown>)[key];
	return value == null ? '' : String(value);
}

/**
 * The link analysis view: broken, external, or orphaned links in a
 * virtualized table. Columns adapt to the selected type.
 * @returns The links view element.
 */
export function LinksView() {
	const [params, setParams] = useSearchParams();
	const { t } = useI18n();
	const type = (params.get('type') as LinkType | null) ?? 'broken';

	const { data, fetchNextPage, hasNextPage, isFetching, isLoading } =
		useLinksInfinite(type);
	const rows = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
	const total = data?.pages[0]?.total ?? 0;

	const columns = useMemo<ColumnDef<LinkRow>[]>(
		() =>
			type === 'orphaned'
				? [
						{
							id: 'url',
							header: t('views.links.colUrl'),
							size: 440,
							accessorFn: (r) => field(r, 'url'),
						},
						{
							id: 'status',
							header: t('views.links.colStatus'),
							size: 90,
							accessorFn: (r) => field(r, 'status') || '—',
						},
						{
							id: 'title',
							header: t('views.links.colTitle'),
							size: 280,
							accessorFn: (r) => field(r, 'title') || '—',
						},
					]
				: [
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
		[type, t],
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
