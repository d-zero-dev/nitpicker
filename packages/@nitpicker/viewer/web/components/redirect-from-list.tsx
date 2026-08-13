import { useI18n } from '../i18n/use-i18n.js';

/** Props for {@link RedirectFromList}. */
export interface RedirectFromListProps {
	/** URLs that redirect to this page. */
	urls: readonly string[];
}

/**
 * URLs that redirect to this page, rendered as a plain list.
 * @param props - The redirect-source URLs.
 * @returns The redirected-from section, or `null` when there are none.
 */
export function RedirectFromList(props: RedirectFromListProps) {
	const { t } = useI18n();
	const { urls } = props;
	if (urls.length === 0) {
		return null;
	}
	return (
		<>
			<h2>
				{t('views.pageDetail.redirectedFrom')} ({urls.length})
			</h2>
			<ul>
				{urls.map((from) => (
					<li key={from}>{from}</li>
				))}
			</ul>
		</>
	);
}
