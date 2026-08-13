import type { ErrorKind, ErrorKindEntry, FailureAttribution } from '@nitpicker/query';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { useErrorKinds } from '../api/use-error-kinds.js';
import { AppLink } from '../components/app-link.js';
import {
	addChecklistFilter,
	addSort,
	createTableControls,
} from '../components/create-table-controls.js';
import { DataTable } from '../components/data-table.js';
import { ViewHeader } from '../components/view-header.js';
import { useListPagination } from '../hooks/use-list-pagination.js';
import { useUrlFilter } from '../hooks/use-url-filter.js';
import { getAttributionLabel } from '../i18n/get-attribution-label.js';
import { getErrorKindLabel } from '../i18n/get-error-kind-label.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * Every {@link ErrorKind} value, used to populate the list's kind filter.
 * Declared as a `Record` (rather than a plain array) so adding a member to
 * the `ErrorKind` union owned by `@nitpicker/crawler` without updating this
 * map is a compile error, not a silently-incomplete filter.
 */
const ERROR_KIND_KEYS: Record<ErrorKind, true> = {
	dns: true,
	'dns-transient': true,
	'connection-refused': true,
	'connection-reset': true,
	'connection-timeout': true,
	tls: true,
	'local-network': true,
	'parse-error': true,
	'client-blocked': true,
	timeout: true,
	protocol: true,
	unknown: true,
};
const ERROR_KINDS = Object.keys(ERROR_KIND_KEYS) as ErrorKind[];

/**
 * Every {@link FailureAttribution} value, used to populate the list's
 * attribution filter. Same exhaustiveness-by-compile-error convention as
 * {@link ERROR_KIND_KEYS}.
 */
const ATTRIBUTION_KEYS: Record<FailureAttribution, true> = {
	site: true,
	network: true,
};
const ATTRIBUTIONS = Object.keys(ATTRIBUTION_KEYS) as FailureAttribution[];

/**
 * Connection-failures master-detail view: hosts that never returned an HTTP
 * response (DNS / TLS / connection / timeout failures), one row per
 * host×kind×attribution row. The list mode (no `?host=`/`?kind=` params, or
 * `kind`/`attribution` alone as column filters) shows the host×kind×attribution
 * rows; selecting a row sets all three params and switches to the detail
 * mode listing that row's sample URLs.
 *
 * `attribution` is optional in the URL for backward compatibility with
 * links/bookmarks saved before this axis existed: a `?host=&kind=` pair with
 * no `attribution` matches every attribution for that (host, kind) — usually
 * one row, but up to two (`site` and `network`) when the same host×kind pair
 * has failures from both causes.
 * @returns The errors view element.
 */
export function ErrorsView() {
	const { params, updateMany } = useUrlFilter();
	const host = params.get('host');
	const kind = params.get('kind');
	const attribution = params.get('attribution');

	if (host !== null && host.length > 0 && kind !== null && kind.length > 0) {
		return (
			<ErrorDetailPane
				// Remounts on every host/kind/attribution change (e.g. browser
				// back/forward between two detail URLs) so the previous row's
				// data never lingers under the new header via usePagedQuery's
				// keepPreviousData.
				key={`${host}\t${kind}\t${attribution ?? ''}`}
				host={host}
				kind={kind as ErrorKind}
				attribution={
					attribution && attribution.length > 0
						? (attribution as FailureAttribution)
						: undefined
				}
				onBack={() =>
					updateMany([
						['host', ''],
						['kind', ''],
						['attribution', ''],
					])
				}
			/>
		);
	}
	return (
		<ErrorListPane
			onSelectRow={(rowHost, rowKind, rowAttribution) => {
				updateMany([
					['host', rowHost],
					['kind', rowKind],
					['attribution', rowAttribution],
				]);
			}}
		/>
	);
}

/**
 * Renders the paginated list of host×kind×attribution rows. Each host cell
 * is a button so the operator can drill into that row's sample URLs without
 * a mouse.
 * @param props - Component props.
 * @param props.onSelectRow - Called with the row's host, kind, and attribution when the operator drills in.
 * @returns The list pane element.
 */
function ErrorListPane({
	onSelectRow,
}: {
	onSelectRow: (host: string, kind: ErrorKind, attribution: FailureAttribution) => void;
}) {
	const { t } = useI18n();
	const { params, updateMany } = useUrlFilter();
	const { pageSize, currentPage, setPage, setPageSize } = useListPagination();
	const filter = {
		host: params.get('host') ?? undefined,
		kind: params.getAll('kind') as ErrorKind[],
		attribution: params.getAll('attribution') as FailureAttribution[],
		sortBy: (params.get('sortBy') ?? undefined) as 'host' | 'kind' | 'count' | undefined,
		sortOrder: (params.get('sortOrder') ?? undefined) as 'asc' | 'desc' | undefined,
	};
	const offset = (currentPage - 1) * pageSize;
	const { data, isFetching, isLoading, isError, error } = useErrorKinds({
		...filter,
		limit: pageSize,
		offset,
	});

	const columns = useMemo<ColumnDef<ErrorKindEntry>[]>(
		() => [
			{
				id: 'host',
				header: t('views.errors.host'),
				size: 300,
				accessorFn: (r) => r.host,
				cell: (info) => {
					const row = info.row.original;
					return (
						<button
							type="button"
							className="link-button"
							onClick={() => onSelectRow(row.host, row.kind, row.attribution)}>
							<code>{row.host}</code>
						</button>
					);
				},
			},
			{
				id: 'kind',
				header: t('views.errors.kind'),
				size: 180,
				accessorFn: (r) => r.kind,
				cell: (info) => getErrorKindLabel(info.getValue<ErrorKind>(), t),
			},
			{
				id: 'attribution',
				header: t('views.errors.attribution'),
				size: 160,
				accessorFn: (r) => r.attribution,
				cell: (info) => getAttributionLabel(info.getValue<FailureAttribution>(), t),
			},
			{
				id: 'count',
				header: t('views.errors.count'),
				size: 100,
				accessorFn: (r) => r.count,
			},
		],
		[t, onSelectRow],
	);
	const columnControls = useMemo(() => {
		const context = { params, updateMany };
		const controls = createTableControls(context);
		addSort(controls, context, 'host', 'host');
		addSort(controls, context, 'kind', 'kind');
		addSort(controls, context, 'count', 'count', 'desc');
		addChecklistFilter(
			controls,
			context,
			'kind',
			'kind',
			t('views.errors.filterKind'),
			ERROR_KINDS.map((value) => ({
				value,
				label: getErrorKindLabel(value, t),
			})),
		);
		addChecklistFilter(
			controls,
			context,
			'attribution',
			'attribution',
			t('views.errors.filterAttribution'),
			ATTRIBUTIONS.map((value) => ({
				value,
				label: getAttributionLabel(value, t),
			})),
		);
		return controls;
	}, [params, t, updateMany]);

	return (
		<div className="view">
			<ViewHeader
				titleKey="views.errors.title"
				descriptionKey="views.errors.description"
			/>
			{data && (
				<p className="state">
					{t('views.errors.total', { total: data.facets.totalRecords })}
					{data.facets.channelSource !== 'none' && (
						<>
							{' · '}
							{t('views.errors.channelSource', { source: data.facets.channelSource })}
						</>
					)}
				</p>
			)}
			<DataTable
				mode="mpa"
				columns={columns}
				data={data?.items ?? []}
				total={data?.total ?? 0}
				currentPage={currentPage}
				pageSize={pageSize}
				onPageChange={setPage}
				onPageSizeChange={setPageSize}
				isFetching={isFetching}
				isLoading={isLoading}
				isError={isError}
				error={error}
				columnControls={columnControls}
			/>
		</div>
	);
}

/**
 * Renders one host×kind×attribution row's sample URLs. `getErrorKinds`
 * returns exactly one row for an exact (host, kind, attribution) triple.
 * `attribution` is optional for backward compatibility with links saved
 * before this axis existed — omitting it can match up to two rows (`site`
 * and `network`), each rendered as its own labeled group so neither is
 * silently dropped the way picking `items[0]` alone would.
 * @param props - Component props.
 * @param props.host - The host to look up.
 * @param props.kind - The classified cause to look up.
 * @param props.attribution - The attribution to look up, or `undefined` to match every attribution for this (host, kind).
 * @param props.onBack - Called when the operator navigates back to the host list.
 * @returns The detail pane element.
 */
function ErrorDetailPane({
	host,
	kind,
	attribution,
	onBack,
}: {
	host: string;
	kind: ErrorKind;
	attribution?: FailureAttribution;
	onBack: () => void;
}) {
	const { t } = useI18n();
	const { data, isLoading, isError, error } = useErrorKinds({ host, kind, attribution });
	const entries = data?.items ?? [];
	// Sum across entries so the header keeps showing a total count in the
	// common single-attribution case too — matching the pre-attribution-axis
	// behavior, which always showed `entry.count` here regardless of how many
	// rows matched.
	const totalCount = entries.reduce((sum, entry) => sum + entry.count, 0);

	return (
		<div className="view">
			<button type="button" className="link-button" onClick={onBack}>
				{t('views.errors.back')}
			</button>
			<ViewHeader
				titleKey="views.errors.detailTitle"
				descriptionKey="views.errors.description"
			/>
			<p>
				<code>{host}</code> — {getErrorKindLabel(kind, t)}
				{entries.length > 0 && ` (${totalCount.toLocaleString()})`}
			</p>
			{isLoading && <div className="state">{t('common.loading')}</div>}
			{isError && (
				<p className="error" role="alert">
					{error?.message ?? 'Error'}
				</p>
			)}
			{!isLoading && !isError && entries.length === 0 && (
				<p className="state">{t('views.errors.notFound')}</p>
			)}
			{!isLoading &&
				!isError &&
				entries.map((entry) => (
					<div key={entry.attribution}>
						{/* Only label the group when both attributions are present
						    (the no-attribution-in-URL backward-compat case) — a
						    single-entry result (the common, new-link case) stays as
						    clean as it was before this axis existed. */}
						{entries.length > 1 && (
							<h3>
								{getAttributionLabel(entry.attribution, t)} (
								{entry.count.toLocaleString()})
							</h3>
						)}
						{/* The failing URL itself can't be opened (that's the whole
						    point of this view), but a `<Link>` — a real `<a>` element,
						    unlike a `<button>` — still lets the URL text be
						    selected/copied for manual diagnosis (curl, dig, …) while
						    also navigating to Page Detail on click. Most of these URLs
						    have a `pages` row (anchor discovery pre-inserts a stub
						    before the anchor row is written), so this usually surfaces
						    who links to the failing URL; a URL with no matching row
						    (e.g. one carrying a hash fragment or userinfo, which isn't
						    preserved in `pages.url`) falls through to Page Detail's
						    "Page not found" state instead of failing silently. */}
						<ul className="url-list">
							{entry.sampleUrls.map((url, index) => (
								<li key={`${url}-${index}`}>
									<AppLink to={`/pages/detail?url=${encodeURIComponent(url)}`}>
										<code>{url}</code>
									</AppLink>
								</li>
							))}
						</ul>
						{entry.overflowedCount > 0 && (
							<p className="state">
								{t('views.errors.overflowed', { count: entry.overflowedCount })}
							</p>
						)}
					</div>
				))}
		</div>
	);
}
