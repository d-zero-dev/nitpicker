import dz from '@d-zero/eslint-config';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import { configs as storybookConfigs } from 'eslint-plugin-storybook';

/**
 * `eslint-plugin-storybook`'s `flat/recommended` ships repo-wide glob `files`
 * patterns (matching any `*.stories.*` or `.storybook/main.*` file) that
 * would apply to any package — only the viewer has Storybook, so each
 * entry's `files` is narrowed to that package below instead of trusting the
 * plugin's default.
 *
 * Looked up by each entry's stable `name` (`storybook:recommended:*`) rather
 * than array index — the plugin could reorder or split `flat/recommended` in
 * a future release, and an index lookup would silently apply the wrong
 * `files` override to the wrong entry instead of failing loudly.
 * @param {string} name - The config entry's `name` field to find.
 * @returns {object} The matching config entry.
 */
function findStorybookConfig(name) {
	const found = storybookConfigs['flat/recommended'].find((entry) => entry.name === name);
	if (!found) {
		throw new Error(`eslint-plugin-storybook: no flat/recommended entry named "${name}"`);
	}
	return found;
}

/**
 * Shared rule overrides for the viewer frontend (React 19 + automatic JSX
 * runtime). Tracks `eslint-plugin-react`, `eslint-plugin-react-hooks`, and
 * `eslint-plugin-jsx-a11y` so the SPA gets actual component-quality and
 * accessibility lint coverage on top of the base TS rules.
 */
const reactRuleSet = {
	...react.configs.flat.recommended.rules,
	...react.configs.flat['jsx-runtime'].rules,
	...reactHooks.configs.recommended.rules,
	...jsxA11y.flatConfigs.recommended.rules,
};

/**
 * @type {import('eslint').ESLint.ConfigData[]}
 */
export default [
	...dz.configs.standard,
	{
		rules: {
			'@typescript-eslint/ban-ts-comment': 0,
			'unicorn/prefer-event-target': 0,
		},
	},
	{
		files: ['*.mjs', '**/*.spec.{js,mjs,ts}'],
		rules: {
			'import/no-extraneous-dependencies': 0,
			'import-x/no-extraneous-dependencies': 0,
		},
	},
	{
		files: ['.textlintrc.js'],
		...dz.configs.commonjs,
	},
	{
		files: ['packages/@nitpicker/viewer/web/**/*.{ts,tsx,js,jsx}'],
		...dz.configs.frontend.at(-1),
	},
	{
		files: ['packages/@nitpicker/viewer/web/**/*.{ts,tsx,js,jsx}'],
		plugins: {
			react,
			'react-hooks': reactHooks,
			'jsx-a11y': jsxA11y,
		},
		languageOptions: {
			parserOptions: {
				ecmaFeatures: { jsx: true },
			},
		},
		settings: {
			react: { version: 'detect' },
		},
		rules: reactRuleSet,
	},
	{
		ignores: ['**/dist/**/*', '**/lib/**/*'],
	},
	findStorybookConfig('storybook:recommended:setup'),
	{
		...findStorybookConfig('storybook:recommended:stories-rules'),
		files: ['packages/@nitpicker/viewer/web/**/*.stories.tsx'],
	},
	{
		...findStorybookConfig('storybook:recommended:main-rules'),
		files: ['packages/@nitpicker/viewer/.storybook/main.ts'],
	},
];
