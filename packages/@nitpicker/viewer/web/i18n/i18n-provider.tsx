import type { I18nValue, Locale } from '../types.js';
import type { ReactNode } from 'react';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { I18nContext } from './i18n-context.js';
import { translations } from './translations.js';

/** localStorage key for the persisted locale. */
const STORAGE_KEY = 'nitpicker-locale';

/**
 * Resolves the initial locale from localStorage, then the browser language,
 * defaulting to English.
 * @returns The initial locale.
 */
function getInitialLocale(): Locale {
	const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
	if (saved === 'en' || saved === 'ja') {
		return saved;
	}
	return globalThis.navigator?.language?.startsWith('ja') ? 'ja' : 'en';
}

/**
 * Looks up a dot-separated key in the given locale's catalog and fills any
 * `{name}` placeholders from `params`.
 * @param locale - The active locale.
 * @param key - Dot-separated key (e.g. `views.pages.title`).
 * @param params - Optional placeholder values.
 * @returns The translated string, or the key itself if not found.
 */
function resolveKey(
	locale: Locale,
	key: string,
	params?: Record<string, string | number>,
): string {
	let node: unknown = translations[locale];
	for (const part of key.split('.')) {
		if (node && typeof node === 'object' && part in node) {
			node = (node as Record<string, unknown>)[part];
		} else {
			return key;
		}
	}
	if (typeof node !== 'string') {
		return key;
	}
	if (!params) {
		return node;
	}
	let result = node;
	for (const [name, value] of Object.entries(params)) {
		result = result.replaceAll(`{${name}}`, String(value));
	}
	return result;
}

/**
 * Provides the i18n context to the app, persisting the locale to localStorage
 * and reflecting it on `<html lang>`.
 * @param props - Children to render within the provider.
 * @param props.children
 * @returns The provider element.
 */
export function I18nProvider(props: { children: ReactNode }) {
	const [locale, setLocale] = useState<Locale>(getInitialLocale);

	useEffect(() => {
		document.documentElement.lang = locale;
		try {
			globalThis.localStorage?.setItem(STORAGE_KEY, locale);
		} catch {
			// Ignore persistence failures (e.g. private browsing quota errors).
		}
	}, [locale]);

	const t = useCallback(
		(key: string, params?: Record<string, string | number>) =>
			resolveKey(locale, key, params),
		[locale],
	);

	const value = useMemo<I18nValue>(() => ({ locale, setLocale, t }), [locale, t]);

	return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>;
}
