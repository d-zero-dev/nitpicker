import { useI18n } from '../i18n/use-i18n.js';

/** The DOM id of the main content region the skip link targets. */
export const MAIN_CONTENT_ID = 'main-content';

/**
 * A keyboard-only "skip to content" link.
 *
 * Visually hidden until focused (see `.skip-link` in `styles.css`), it is the
 * first focusable element on the page so keyboard and screen-reader users can
 * bypass the 11-item sidebar navigation and jump straight to `#main-content`.
 * @returns The skip link element.
 */
export function SkipLink() {
	const { t } = useI18n();
	return (
		<a className="skip-link" href={`#${MAIN_CONTENT_ID}`}>
			{t('common.skipToContent')}
		</a>
	);
}
