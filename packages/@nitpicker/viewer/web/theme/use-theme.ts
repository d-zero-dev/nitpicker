import { useCallback, useEffect, useState } from 'react';

/** localStorage key for the persisted theme. */
const STORAGE_KEY = 'nitpicker-theme';

/**
 * Theme state hook: resolves the initial theme from localStorage or the OS
 * preference, reflects it on `<html data-theme>`, and persists changes.
 * @returns The current theme and a toggle function.
 */
export function useTheme(): { theme: 'dark' | 'light'; toggleTheme: () => void } {
	const [theme, setTheme] = useState<'dark' | 'light'>(() => {
		const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
		if (saved === 'dark' || saved === 'light') {
			return saved;
		}
		return globalThis.matchMedia?.('(prefers-color-scheme: light)').matches
			? 'light'
			: 'dark';
	});

	useEffect(() => {
		document.documentElement.dataset.theme = theme;
		try {
			globalThis.localStorage?.setItem(STORAGE_KEY, theme);
		} catch {
			// Ignore persistence failures (e.g. private browsing quota errors).
		}
	}, [theme]);

	const toggleTheme = useCallback(() => {
		setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
	}, []);

	return { theme, toggleTheme };
}
