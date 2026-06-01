import { useI18n } from '../i18n/use-i18n.js';
import { useTheme } from '../theme/use-theme.js';

/**
 * A button that toggles between dark and light themes.
 * @returns The toggle button element.
 */
export function ThemeToggle() {
	const { theme, toggleTheme } = useTheme();
	const { t } = useI18n();
	const label = theme === 'dark' ? t('theme.toLight') : t('theme.toDark');
	return (
		<button
			type="button"
			className="icon-button"
			onClick={toggleTheme}
			aria-label={label}
			title={label}>
			{theme === 'dark' ? '☀' : '☾'}
		</button>
	);
}
