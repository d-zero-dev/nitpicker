import type { ErrorKindCount } from '@nitpicker/query';

import { getAttributionLabel } from '../i18n/get-attribution-label.js';
import { getErrorKindLabel } from '../i18n/get-error-kind-label.js';
import { useI18n } from '../i18n/use-i18n.js';
import { computeRatio } from '../utils/compute-ratio.js';
import { formatPercent } from '../utils/format-percent.js';

/** Props for {@link ErrorKindBreakdownList}. */
export interface ErrorKindBreakdownListProps {
	/** The parent `status === -1` row's count — denominator for each sub-row's ratio. */
	parentCount: number;
	/** Per-cause breakdown of the parent row. */
	breakdown: readonly ErrorKindCount[];
}

/**
 * Per-cause breakdown of the Summary view's `status === -1` row, one bar per
 * `(kind, attribution)` pair. Each sub-bar's ratio is relative to the parent
 * `-1` count, not the global total — it describes the composition of hard
 * failures, not their share of all pages. The `role="group"`/`aria-label`
 * pairing lives on the caller's wrapping element, not here, since it
 * describes the group *and* its sibling summary bar together.
 * @param props - The parent count and per-cause breakdown.
 * @returns The breakdown list element.
 */
export function ErrorKindBreakdownList(props: ErrorKindBreakdownListProps) {
	const { t } = useI18n();
	return (
		<ul className="plain-list error-kind-breakdown-list">
			{props.breakdown.map((sub) => {
				// Denominator is the parent -1 count so the sub-bars describe the
				// composition of -1, not the global mix.
				const subRatio = computeRatio(sub.count, props.parentCount);
				return (
					// Keyed on kind+attribution, not kind alone: the same kind (e.g.
					// 'dns') can appear twice — once site-caused, once network-caused
					// (outage-attributed) — and both rows must render, not
					// collide/overwrite in React's reconciliation.
					<li key={`${sub.kind}-${sub.attribution}`} className="bar-row">
						<span style={{ width: 110 }}>
							{getErrorKindLabel(sub.kind, t)}
							{/* Only the network-caused rows get an extra label — the
							    site-caused case is the pre-existing, unsurprising default
							    and stays visually unchanged. */}
							{sub.attribution === 'network' && (
								<>
									{' · '}
									<small>{getAttributionLabel(sub.attribution, t)}</small>
								</>
							)}
						</span>
						<span className="bar-track">
							<span className="bar-fill" style={{ width: `${subRatio * 100}%` }} />
						</span>
						<span>
							{sub.count.toLocaleString()} <small>({formatPercent(subRatio)})</small>
						</span>
					</li>
				);
			})}
		</ul>
	);
}
