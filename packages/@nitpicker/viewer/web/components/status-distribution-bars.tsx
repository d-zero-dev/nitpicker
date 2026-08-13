import type { StatusCount } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';
import { computeRatio } from '../utils/compute-ratio.js';
import { formatPercent } from '../utils/format-percent.js';

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
				{/* Fixed width 60 for every row keeps the bar tracks aligned; the
				    long inventory-seed label wraps inside it instead of pushing
				    its bar out of column. */}
				<span style={{ width: 60 }}>{props.label}</span>
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
}

/**
 * The status-distribution section of the Summary view: one bar per HTTP
 * status bucket, each showing its share of the total. The `status === -1`
 * hard-failure bucket may additionally show a per-cause breakdown (see
 * {@link ErrorKindBreakdownList}).
 * @param props - The status-distribution entries.
 * @returns The bar group element.
 */
export function StatusDistributionBars(props: StatusDistributionBarsProps) {
	const total = props.entries.reduce((acc, entry) => acc + entry.count, 0);
	return (
		<div className="bars">
			{props.entries.map((entry) => {
				const { key, label } = buildStatusRowDescriptor(entry);
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
}
