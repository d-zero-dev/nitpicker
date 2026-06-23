import { usePaginationMode } from '../hooks/use-pagination-mode.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * A TopBar button that toggles between MPA (`'mpa'`) and virtual scroll
 * (`'virtual'`) pagination modes.
 *
 * The current mode is persisted in localStorage so it survives reloads, and
 * the change immediately re-renders every list view consumer in the tab via
 * the {@link usePaginationMode} singleton store. The button's icon and
 * `aria-label` reflect the *next* mode the user will land in if clicked —
 * same UX promise as the existing ThemeToggle.
 * @returns The toggle button element.
 */
export function PaginationModeToggle() {
	const { mode, toggleMode } = usePaginationMode();
	const { t } = useI18n();
	const label = mode === 'mpa' ? t('pagination.toVirtual') : t('pagination.toMpa');
	return (
		<button
			type="button"
			className="icon-button"
			onClick={toggleMode}
			aria-label={label}
			title={label}
			data-mode={mode}>
			{mode === 'mpa' ? '∞' : '📄'}
		</button>
	);
}
