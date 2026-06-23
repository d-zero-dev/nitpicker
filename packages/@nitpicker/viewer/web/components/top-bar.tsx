import { useIsFetching } from '@tanstack/react-query';

import { useI18n } from '../i18n/use-i18n.js';

import { LanguageToggle } from './language-toggle.js';
import { PaginationModeToggle } from './pagination-mode-toggle.js';
import { ThemeToggle } from './theme-toggle.js';

/**
 * The top bar: app title, language + theme controls, and a global loading
 * indicator that appears whenever any query is in flight.
 * @returns The top bar element.
 */
export function TopBar() {
	const isFetching = useIsFetching();
	const { t } = useI18n();
	return (
		<header className="top-bar">
			<div className="top-bar-title">{t('app.title')}</div>
			<div className="top-bar-actions">
				<LanguageToggle />
				<PaginationModeToggle />
				<ThemeToggle />
			</div>
			{isFetching > 0 && (
				<div
					className="top-bar-progress"
					role="progressbar"
					aria-label={t('common.loading')}
				/>
			)}
		</header>
	);
}
