import { useI18n } from '../i18n/use-i18n.js';

/** Props for {@link ClusterStructuralCoreTokenList}. */
export interface ClusterStructuralCoreTokenListProps {
	/** The visible structural-core tokens (`reason.structuralCoreTokens`). */
	tokens: readonly string[];
	/**
	 * Tokens found but not carried in `tokens` — the difference between
	 * `reason.structuralCoreTokenCount` and `reason.structuralCoreTokens.length`.
	 */
	hiddenCount: number;
}

/**
 * Renders the DOM-structure tokens `@d-zero/page-cluster` found common to
 * every member of a Pass-0 block, plus a "N more" note when the reason
 * summary truncated the full token list for API transport.
 *
 * Always renders its `<dt>`/`<dd>` pair — an empty `tokens` list is a
 * legitimate "no shared structural core" result worth showing, not an
 * absent-data case to hide.
 * @param props - The visible tokens and the truncated count.
 * @returns The `<dt>`/`<dd>` pair element.
 */
export function ClusterStructuralCoreTokenList(
	props: ClusterStructuralCoreTokenListProps,
) {
	const { t } = useI18n();
	const { tokens, hiddenCount } = props;
	return (
		<>
			<dt>{t('views.templateClusters.structuralCore')}</dt>
			<dd>
				<ul>
					{tokens.map((token) => (
						<li key={token}>
							<code>{token}</code>
						</li>
					))}
				</ul>
				{hiddenCount > 0 && (
					<p className="view-description">
						{t('views.templateClusters.structuralCoreMore', { count: hiddenCount })}
					</p>
				)}
			</dd>
		</>
	);
}
