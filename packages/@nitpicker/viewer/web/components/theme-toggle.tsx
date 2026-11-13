import { useCommandTarget } from '../hooks/use-command-target.js';
import { useI18n } from '../i18n/use-i18n.js';
import { useTheme } from '../theme/use-theme.js';

/**
 * A button that toggles between dark and light themes. The button is its own
 * `commandfor` target: it receives the `--toggle` command it sends.
 * @returns The toggle button element.
 */
export function ThemeToggle() {
	const { theme, toggleTheme } = useTheme();
	const { t } = useI18n();
	const { id, ref } = useCommandTarget<HTMLButtonElement>({
		'--toggle': toggleTheme,
	});
	const label = theme === 'dark' ? t('theme.toLight') : t('theme.toDark');
	return (
		<button
			ref={ref}
			id={id}
			type="button"
			command="--toggle"
			commandfor={id}
			className="icon-button"
			aria-label={label}
			title={label}>
			{theme === 'dark' ? '☀' : '☾'}
		</button>
	);
}
