import { Fragment } from 'react';

import { useI18n } from '../i18n/use-i18n.js';

/** Props for {@link SummaryExcludes}. */
export interface SummaryExcludesProps {
	/** URL patterns excluded from the crawl. */
	excludes: readonly string[];
	/** Keywords that excluded a URL when present in it. */
	excludeKeywords: readonly string[];
	/** URL prefixes excluded from the crawl. */
	excludeUrls: readonly string[];
	/** Maximum directory depth of excluded paths; `0` means unset. */
	maxExcludedDepth: number;
}

/**
 * The Summary view's crawl exclusions, collapsed into a `<details>` whose
 * summary carries the total count. Most archives crawl without exclusions,
 * and a few archives carry hundreds of patterns, so the block stays out of
 * the way until opened and then lists every entry on its own line rather
 * than joining them into one long run of text. Each empty group is skipped,
 * and the whole block renders nothing when no exclusion is configured.
 * @param props - The four exclusion settings.
 * @returns The collapsed exclusions, or `null` when nothing is excluded.
 * @example
 * <SummaryExcludes
 *   excludes={['/private/']}
 *   excludeKeywords={[]}
 *   excludeUrls={[]}
 *   maxExcludedDepth={0}
 * />
 */
export function SummaryExcludes(props: SummaryExcludesProps) {
	const { t } = useI18n();
	const groups = [
		{ key: 'excludes', items: props.excludes },
		{ key: 'excludeKeywords', items: props.excludeKeywords },
		{ key: 'excludeUrls', items: props.excludeUrls },
	].filter((group) => group.items.length > 0);
	const count = groups.reduce((acc, group) => acc + group.items.length, 0);
	if (count === 0 && props.maxExcludedDepth <= 0) {
		return null;
	}
	return (
		<details className="summary-excludes">
			<summary>{t('views.summary.excludeSettings', { count })}</summary>
			<dl className="detail-grid">
				{groups.map((group) => (
					<Fragment key={group.key}>
						<dt>{t(`views.summary.${group.key}`)}</dt>
						<dd>
							<ul>
								{group.items.map((item) => (
									<li key={item}>
										<code>{item}</code>
									</li>
								))}
							</ul>
						</dd>
					</Fragment>
				))}
				{props.maxExcludedDepth > 0 && (
					<>
						<dt>{t('views.summary.maxExcludedDepth')}</dt>
						<dd>{props.maxExcludedDepth}</dd>
					</>
				)}
			</dl>
		</details>
	);
}
