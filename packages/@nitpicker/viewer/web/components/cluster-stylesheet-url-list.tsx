import { useI18n } from '../i18n/use-i18n.js';

/** Props for {@link ClusterStylesheetUrlList}. */
export interface ClusterStylesheetUrlListProps {
	/** i18n key for the `<dt>` label. */
	titleKey: string;
	/** The stylesheet URLs to list. */
	urls: readonly string[];
	/** i18n key for the caveat shown under the list when `urls` is non-empty. */
	caveatKey: string;
	/**
	 * i18n key for the fallback text shown in `<dd>` when `urls` is empty.
	 * When omitted, the whole `<dt>`/`<dd>` pair is hidden on empty input —
	 * used by the distinctive-stylesheet call site, which has nothing
	 * meaningful to say when a cluster's blocking evidence carries no CSS
	 * set. The common-stylesheet call site passes this to show a
	 * "no common stylesheet" message instead.
	 */
	emptyLabelKey?: string;
}

/**
 * Renders one stylesheet-URL list — either a cluster's `@d-zero/page-cluster`
 * blocking-distinctive CSS set or its raw common-stylesheet intersection.
 * Both call sites share this component because they render identical
 * markup (a `<ul>` of URLs plus a caveat paragraph) and differ only in
 * which i18n keys and empty-state behavior apply.
 * @param props - The list's data and i18n keys.
 * @returns The `<dt>`/`<dd>` pair, or `null` when `urls` is empty and no
 *   {@link ClusterStylesheetUrlListProps.emptyLabelKey} was given.
 * @example
 * ```tsx
 * <ClusterStylesheetUrlList
 *   titleKey="views.templateClusters.commonStylesheets"
 *   urls={cluster.commonStylesheetUrls}
 *   caveatKey="views.templateClusters.commonCssCaveat"
 *   emptyLabelKey="views.templateClusters.noCommonCss"
 * />
 * ```
 */
export function ClusterStylesheetUrlList(props: ClusterStylesheetUrlListProps) {
	const { t } = useI18n();
	const { titleKey, urls, caveatKey, emptyLabelKey } = props;

	if (urls.length === 0) {
		if (emptyLabelKey === undefined) {
			return null;
		}
		return (
			<>
				<dt>{t(titleKey)}</dt>
				<dd>{t(emptyLabelKey)}</dd>
			</>
		);
	}

	return (
		<>
			<dt>{t(titleKey)}</dt>
			<dd>
				<ul>
					{urls.map((url) => (
						<li key={url}>{url}</li>
					))}
				</ul>
				<p className="view-description">{t(caveatKey)}</p>
			</dd>
		</>
	);
}
