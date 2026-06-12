import { useI18n } from '../i18n/use-i18n.js';

/** Props for {@link ViewHeader}. */
export interface ViewHeaderProps {
	/** i18n key for the view title. */
	titleKey: string;
	/** i18n key for the view description (shown directly under the title). */
	descriptionKey: string;
}

/**
 * A view's heading: the title followed immediately by a localized description.
 * @param props - The title and description i18n keys.
 * @returns The header element.
 */
export function ViewHeader(props: ViewHeaderProps) {
	const { t } = useI18n();
	return (
		<header className="view-header">
			<h1>{t(props.titleKey)}</h1>
			<p className="view-description">{t(props.descriptionKey)}</p>
		</header>
	);
}
