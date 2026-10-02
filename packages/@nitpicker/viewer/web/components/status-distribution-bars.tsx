import type { StatusCount } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';
import { computeRatio } from '../utils/compute-ratio.js';
import { formatPercent } from '../utils/format-percent.js';

import { AppLink } from './app-link.js';
import { buildStatusRowDescriptor } from './build-status-row-descriptor.js';
import { ErrorKindBreakdownList } from './error-kind-breakdown-list.js';

/**
 * One status-distribution row: the bar itself, plus (for the `status === -1`
 * hard-failure row) an expandable per-cause breakdown.
 * @param props - The row's entry, its display label, and its ratio of the group total.
 * @param props.entry - The status-distribution entry to render.
 * @param props.label - The row's display label, from {@link buildStatusRowDescriptor}
 *   (computed once by the caller, which also needs it for the row's `key`).
 * @param props.ratio - The entry's share of {@link StatusDistributionBars}'s total.
 */
function StatusDistributionRow(props: {
	entry: StatusCount;
	label: string;
	ratio: number;
}) {
	const { t } = useI18n();
	const showBreakdown =
		props.entry.status === -1 &&
		props.entry.errorKindBreakdown !== undefined &&
		props.entry.errorKindBreakdown.length > 0;
	return (
		<div
			role={showBreakdown ? 'group' : undefined}
			aria-label={
				showBreakdown
					? t('views.summary.statusBreakdownAria', { count: props.entry.count })
					: undefined
			}>
			<div className="bar-row">
				<span>{props.label}</span>
				<span className="bar-track">
					<span className="bar-fill" style={{ width: `${props.ratio * 100}%` }} />
				</span>
				<span>
					{props.entry.count.toLocaleString()}{' '}
					<small>({formatPercent(props.ratio)})</small>
				</span>
			</div>
			{showBreakdown && props.entry.errorKindBreakdown && (
				<ErrorKindBreakdownList
					parentCount={props.entry.count}
					breakdown={props.entry.errorKindBreakdown}
				/>
			)}
		</div>
	);
}

/** Props for {@link StatusDistributionBars}. */
export interface StatusDistributionBarsProps {
	/** The status-distribution entries to render, each as a share of the whole. */
	entries: readonly StatusCount[];
	/**
	 * Whether the error group's heading links to the viewer-only connection
	 * errors screen (`/errors`). Defaults to `true`; the static HTML report has
	 * no such screen and passes `false`.
	 */
	showErrorsLink?: boolean;
}

/**
 * Whether an entry is a failure to get any HTTP response at all: the `-1`
 * fetch-failure sentinel, or a status that was never recorded (`null`).
 * @param entry - The status-distribution entry.
 * @returns `true` when the page never produced an HTTP status.
 */
function isErrorEntry(entry: StatusCount): boolean {
	return entry.status === null || entry.status < 0;
}

/**
 * The status-distribution section of the Summary view: one bar per status
 * bucket, each showing its share of the **whole** total, split into two
 * groups so a real HTTP response (2xx–5xx) is never mixed up with a page
 * Nitpicker could not fetch at all. The error group (`-1` fetch errors and
 * unrecorded statuses) links to the connection errors screen and may show a
 * per-cause breakdown on the `-1` row (see {@link ErrorKindBreakdownList}).
 * An empty group is omitted.
 * @param props - The status-distribution entries.
 * @returns The grouped bar elements.
 */
export function StatusDistributionBars(props: StatusDistributionBarsProps) {
	const { t } = useI18n();
	const total = props.entries.reduce((acc, entry) => acc + entry.count, 0);
	const responses = props.entries.filter((entry) => !isErrorEntry(entry));
	const errors = props.entries.filter((entry) => isErrorEntry(entry));
	const renderRows = (entries: readonly StatusCount[]) => (
		<div className="bars">
			{entries.map((entry) => {
				const { key, label } = buildStatusRowDescriptor(entry, t);
				return (
					<StatusDistributionRow
						key={key}
						entry={entry}
						label={label}
						ratio={computeRatio(entry.count, total)}
					/>
				);
			})}
		</div>
	);
	return (
		<>
			{responses.length > 0 && (
				<>
					<h3>{t('views.summary.statusGroupResponses')}</h3>
					{renderRows(responses)}
				</>
			)}
			{errors.length > 0 && (
				<>
					<div className="section-heading section-heading-sub">
						<h3>{t('views.summary.statusGroupErrors')}</h3>
						{props.showErrorsLink !== false && (
							<AppLink to="/errors">{t('views.summary.viewConnectionErrors')}</AppLink>
						)}
					</div>
					{renderRows(errors)}
				</>
			)}
		</>
	);
}
