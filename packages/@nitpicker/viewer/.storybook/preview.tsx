import type { Locale } from '../web/types.js';
import type { Preview } from '@storybook/react-vite';
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';

import { I18nProvider } from '../web/i18n/i18n-provider.js';
import { useI18n } from '../web/i18n/use-i18n.js';
import '../web/styles.css';

/**
 * One `QueryClient` for the whole Storybook session (not per story): stories
 * never mutate server state, so nothing needs invalidating between renders.
 * Options mirror `app.tsx`'s client so mocked-data components behave the same
 * as they do in the real app.
 */
const queryClient = new QueryClient({
	defaultOptions: {
		queries: { refetchOnWindowFocus: false, staleTime: 60_000, retry: false },
	},
});

/**
 * Reflects the toolbar's `locale` global into the real `I18nProvider` via its
 * `setLocale`, the same setter `LanguageToggle` calls — no component-side
 * change needed to make the toolbar control authoritative.
 */
function LocaleSync(props: { locale: Locale; children: ReactNode }) {
	const { locale, setLocale } = useI18n();
	useEffect(() => {
		if (locale !== props.locale) {
			setLocale(props.locale);
		}
	}, [props.locale, locale, setLocale]);
	return props.children;
}

/**
 * Reflects the toolbar's `theme` global onto `<html data-theme>`, the same
 * attribute `useTheme()` manages in the real app. There is no `ThemeProvider`
 * to wrap here because the app doesn't have one either — theme is a DOM
 * attribute, not React context.
 *
 * `ThemeToggle`'s own story is the one exception: `useTheme()` resolves its
 * initial state from localStorage/`matchMedia` independently of this global,
 * so toggling the toolbar changes the page's CSS variables but not that
 * component's own rendered icon.
 */
function ThemeSync(props: { theme: 'dark' | 'light'; children: ReactNode }) {
	useEffect(() => {
		document.documentElement.dataset.theme = props.theme;
	}, [props.theme]);
	return props.children;
}

const preview: Preview = {
	parameters: {
		controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
		a11y: { test: 'todo' },
	},
	globalTypes: {
		theme: {
			description: 'Global theme for components',
			toolbar: {
				title: 'Theme',
				icon: 'circlehollow',
				items: [
					{ value: 'dark', icon: 'moon', title: 'Dark' },
					{ value: 'light', icon: 'sun', title: 'Light' },
				],
				dynamicTitle: true,
			},
		},
		locale: {
			description: 'Global locale for components',
			toolbar: {
				title: 'Locale',
				icon: 'globe',
				items: [
					{ value: 'en', title: 'English' },
					{ value: 'ja', title: '日本語' },
				],
				dynamicTitle: true,
			},
		},
	},
	initialGlobals: { theme: 'dark', locale: 'en' },
	decorators: [
		(Story, context) => (
			<QueryClientProvider client={queryClient}>
				<I18nProvider>
					<LocaleSync locale={context.globals.locale as Locale}>
						<ThemeSync theme={context.globals.theme as 'dark' | 'light'}>
							<Story />
						</ThemeSync>
					</LocaleSync>
				</I18nProvider>
			</QueryClientProvider>
		),
	],
};

export default preview;
