import type { Locale } from '../types.js';

import { useI18n } from '../i18n/use-i18n.js';

/**
 * A select control for switching the UI language (English / Japanese).
 * @returns The language select element.
 */
export function LanguageToggle() {
	const { locale, setLocale, t } = useI18n();
	return (
		<select
			className="lang-select"
			aria-label={t('language.label')}
			value={locale}
			onChange={(e) => {
				setLocale(e.target.value as Locale);
			}}>
			<option value="en">EN</option>
			<option value="ja">JA</option>
		</select>
	);
}
