import type { StorybookConfig } from '@storybook/react-vite';

/**
 * No `viteFinal` React plugin is added here: Vite 8 (Rolldown-based) ships
 * JSX transform and Fast Refresh (`vite:react-babel`,
 * `vite:react:refresh-wrapper`) as built-ins, so `@storybook/react-vite`
 * works against this project's `vite@8.2.0` with no extra plugin. Adding
 * `@vitejs/plugin-react` here double-registers the refresh preamble and
 * throws `Identifier 'RefreshRuntime' has already been declared` at runtime
 * — verified by disabling it and confirming the built-in alone renders
 * every story.
 *
 * `reactDocgen: 'react-docgen-typescript'` (not the package's babel-based
 * default) is required for `data-table.tsx`'s discriminated union
 * (`DataTableMpaProps<T> | DataTableVirtualProps<T>`) to resolve correctly in
 * the autodocs Controls table — the babel-based docgen flattens unions into
 * an unreadable superset of props. `tsconfigPath` must point at
 * `tsconfig.web.json` explicitly — the package-root `tsconfig.json` (the
 * backend build's config) only includes `src/**`, so without this the docgen
 * plugin silently skips every `web/` component. The path resolves relative to
 * the package root (Storybook's build cwd), not this `.storybook/` file.
 */
const config: StorybookConfig = {
	stories: ['../web/components/*.stories.tsx'],
	addons: ['@storybook/addon-a11y'],
	framework: {
		name: '@storybook/react-vite',
		options: {},
	},
	typescript: {
		reactDocgen: 'react-docgen-typescript',
		reactDocgenTypescriptOptions: {
			tsconfigPath: './tsconfig.web.json',
		},
	},
};

export default config;
