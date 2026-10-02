import { useI18n } from '../i18n/use-i18n.js';

import { ExternalUrl } from './external-url.js';

/** Props for {@link SummaryRoots}. */
export interface SummaryRootsProps {
	/** The crawl's root (target) URLs, in the order they were given. */
	roots: readonly string[];
}

/**
 * The Summary view's target URL block: the root URL(s) the archive was
 * crawled from, set apart in a prominent card because they answer "what is
 * this archive of?" before any number below does. A single root is shown
 * large on its own; several roots (multi-root crawl) are listed. Renders
 * nothing when the archive has no roots.
 * @param props - The root URLs.
 * @returns The target URL card, or `null` when there are no roots.
 * @example
 * <SummaryRoots roots={['https://example.com/']} />
 */
export function SummaryRoots(props: SummaryRootsProps) {
	const { t } = useI18n();
	if (props.roots.length === 0) {
		return null;
	}
	return (
		<section className="summary-roots" aria-label={t('views.summary.targetUrl')}>
			<p className="summary-roots-label">{t('views.summary.targetUrl')}</p>
			{props.roots.length === 1 ? (
				<p className="summary-roots-url">
					<ExternalUrl url={props.roots[0]!} />
				</p>
			) : (
				<ul className="summary-roots-list">
					{props.roots.map((root) => (
						<li key={root}>
							<ExternalUrl url={root} />
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
