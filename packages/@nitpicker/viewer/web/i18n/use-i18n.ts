import type { I18nValue } from '../types.js';

import { useContext } from 'react';

import { I18nContext } from './i18n-context.js';

/**
 * Accesses the i18n context (locale + translate function).
 * @returns The current {@link I18nValue}.
 * @throws {Error} If used outside an `I18nProvider`.
 */
export function useI18n(): I18nValue {
	const context = useContext(I18nContext);
	if (!context) {
		throw new Error('useI18n must be used within an I18nProvider');
	}
	return context;
}
