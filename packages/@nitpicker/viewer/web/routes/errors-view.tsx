import type { ErrorKind, ErrorKindEntry } from '@nitpicker/query';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';
import { Link } from 'react-router';

import { useErrorKinds } from '../api/use-error-kinds.js';
import {
	addRadioFilter,
	addSort,
	createTableControls,
} from '../components/create-table-controls.js';
import { DataTable } from '../components/data-table.js';
import { ViewHeader } from '../components/view-header.js';
import { useListPagination } from '../hooks/use-list-pagination.js';
import { useUrlFilter } from '../hooks/use-url-filter.js';
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
 * Connection-failures master-detail view: hosts that never returned an HTTP
 * response (DNS / TLS / connection / timeout failures), one row per
 * host×kind pair. The list mode (no `?host=`/`?kind=` params, or `kind` alone
 * as a column filter) shows the host×kind rows; selecting a row sets both
 * params and switches to the detail mode listing that pair's sample URLs.
 * @returns The errors view element.
 */
export function ErrorsView() {
	const { params, updateMany } = useUrlFilter();
	const host = params.get('host');
	const kind = params.get('kind');

	if (host !== null && host.length > 0 && kind !== null && kind.length > 0) {
		return (
			<ErrorDetailPane
				// Remounts on every host/kind change (e.g. browser back/forward
				// between two detail URLs) so the previous pair's data never
				// lingers under the new header via usePagedQuery's keepPreviousData.
				key={`${host}\t${kind}`}
				host={host}
				kind={kind as ErrorKind}
				onBack={() =>
					updateMany([
						['host', ''],
						['kind', ''],
					])
				}
			/>
		);
	}
	return (
		<ErrorListPane
			onSelectRow={(rowHost, rowKind) => {
				updateMany([
					['host', rowHost],
					['kind', rowKind],
				]);
			}}
		/>
	);
}

/**
 * Renders the paginated list of host×kind rows. Each host cell is a button
 * so the operator can drill into that pair's sample URLs without a mouse.
 * @param props - Component props.
 * @param props.onSelectRow - Called with the row's host and kind when the operator drills in.
 * @returns The list pane element.
 */
function ErrorListPane({
	onSelectRow,
}: {
	onSelectRow: (host: string, kind: ErrorKind) => void;
}) {
	const { t } = useI18n();
	const { params, updateMany } = useUrlFilter();
	const { pageSize, currentPage, setPage, setPageSize } = useListPagination();
	const filter = {
		host: params.get('host') ?? undefined,
		kind: (params.get('kind') ?? undefined) as ErrorKind | undefined,
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
				size: 320,
				accessorFn: (r) => r.host,
				cell: (info) => {
					const row = info.row.original;
					return (
						<button
							type="button"
							className="link-button"
							onClick={() => onSelectRow(row.host, row.kind)}>
							<code>{row.host}</code>
						</button>
					);
				},
			},
			{
				id: 'kind',
				header: t('views.errors.kind'),
				size: 200,
				accessorFn: (r) => r.kind,
				cell: (info) => getErrorKindLabel(info.getValue<ErrorKind>(), t),
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
		addRadioFilter(controls, context, 'kind', 'kind', t('views.errors.filterKind'), [
			{ value: '', label: t('common.all'), checked: false },
			...ERROR_KINDS.map((value) => ({
				value,
				label: getErrorKindLabel(value, t),
				checked: false,
			})),
		]);
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
 * Renders a single host×kind pair's sample URLs. `getErrorKinds` returns at
 * most one row for an exact (host, kind) pair, so `items[0]` is the whole
 * answer — no further pagination is needed.
 * @param props - Component props.
 * @param props.host - The host to look up.
 * @param props.kind - The classified cause to look up.
 * @param props.onBack - Called when the operator navigates back to the host list.
 * @returns The detail pane element.
 */
function ErrorDetailPane({
	host,
	kind,
	onBack,
}: {
	host: string;
	kind: ErrorKind;
	onBack: () => void;
}) {
	const { t } = useI18n();
	const { data, isLoading, isError, error } = useErrorKinds({ host, kind });
	const entry = data?.items[0];

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
				{entry && ` (${entry.count.toLocaleString()})`}
			</p>
			{isLoading && <div className="state">{t('common.loading')}</div>}
			{isError && (
				<p className="error" role="alert">
					{error?.message ?? 'Error'}
				</p>
			)}
			{!isLoading && !isError && entry == null && (
				<p className="state">{t('views.errors.notFound')}</p>
			)}
			{!isLoading && !isError && entry != null && (
				// The failing URL itself can't be opened (that's the whole point of
				// this view), but a `<Link>` — a real `<a>` element, unlike a
				// `<button>` — still lets the URL text be selected/copied for manual
				// diagnosis (curl, dig, …) while also navigating to Page Detail on
				// click. Most of these URLs have a `pages` row (anchor discovery
				// pre-inserts a stub before the anchor row is written), so this
				// usually surfaces who links to the failing URL; a URL with no
				// matching row (e.g. one carrying a hash fragment or userinfo, which
				// isn't preserved in `pages.url`) falls through to Page Detail's
				// "Page not found" state instead of failing silently.
				<ul className="url-list">
					{entry.sampleUrls.map((url, index) => (
						<li key={`${url}-${index}`}>
							<Link to={`/pages/detail?url=${encodeURIComponent(url)}`}>
								<code>{url}</code>
							</Link>
						</li>
					))}
				</ul>
			)}
			{entry != null && entry.overflowedCount > 0 && (
				<p className="state">
					{t('views.errors.overflowed', { count: entry.overflowedCount })}
				</p>
			)}
		</div>
	);
}
