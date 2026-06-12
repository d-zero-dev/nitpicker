import dz from '@d-zero/eslint-config';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

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
];
