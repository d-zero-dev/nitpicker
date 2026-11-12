import config from '@d-zero/oxlint-config';

/**
 * Lint is oxlint-native only; the ESLint-only rules below are intentionally absent:
 * `no-restricted-syntax` (the `#private` over `private` convention is review-only),
 * `import-x/*` (order, no-extraneous-dependencies), `sort-class-members`,
 * `eslint-plugin-regexp` and `eslint-plugin-storybook`. oxlint has no equivalent of
 * `react/no-deprecated`, `react/prop-types` (unneeded with TypeScript) or the React
 * Compiler rules of `eslint-plugin-react-hooks`, so the viewer's react, react-hooks
 * and jsx-a11y rules are enumerated explicitly (oxlint enables only the correctness
 * category by default).
 */
const viewerReactRules = Object.fromEntries(
	[
		'react/display-name',
		'react/jsx-key',
		'react/jsx-no-comment-textnodes',
		'react/jsx-no-duplicate-props',
		'react/jsx-no-target-blank',
		'react/jsx-no-undef',
		'react/no-children-prop',
		'react/no-danger-with-children',
		'react/no-direct-mutation-state',
		'react/no-find-dom-node',
		'react/no-is-mounted',
		'react/no-render-return-value',
		'react/no-string-refs',
		'react/no-unescaped-entities',
		'react/no-unknown-property',
		'react/no-unsafe',
		'react/require-render-return',
		'react/rules-of-hooks',
		'jsx-a11y/alt-text',
		'jsx-a11y/anchor-has-content',
		'jsx-a11y/anchor-is-valid',
		'jsx-a11y/aria-activedescendant-has-tabindex',
		'jsx-a11y/aria-props',
		'jsx-a11y/aria-proptypes',
		'jsx-a11y/aria-role',
		'jsx-a11y/aria-unsupported-elements',
		'jsx-a11y/autocomplete-valid',
		'jsx-a11y/click-events-have-key-events',
		'jsx-a11y/heading-has-content',
		'jsx-a11y/html-has-lang',
		'jsx-a11y/iframe-has-title',
		'jsx-a11y/img-redundant-alt',
		'jsx-a11y/interactive-supports-focus',
		'jsx-a11y/label-has-associated-control',
		'jsx-a11y/lang',
		'jsx-a11y/media-has-caption',
		'jsx-a11y/mouse-events-have-key-events',
		'jsx-a11y/no-access-key',
		'jsx-a11y/no-autofocus',
		'jsx-a11y/no-distracting-elements',
		'jsx-a11y/no-interactive-element-to-noninteractive-role',
		'jsx-a11y/no-noninteractive-element-interactions',
		'jsx-a11y/no-noninteractive-element-to-interactive-role',
		'jsx-a11y/no-noninteractive-tabindex',
		'jsx-a11y/no-redundant-roles',
		'jsx-a11y/no-static-element-interactions',
		'jsx-a11y/role-has-required-aria-props',
		'jsx-a11y/role-supports-aria-props',
		'jsx-a11y/scope',
		'jsx-a11y/tabindex-no-positive',
	].map((rule) => [rule, 'error']),
);

// `exhaustive-deps` is advisory in the react-hooks recommended preset.
viewerReactRules['react/exhaustive-deps'] = 'warn';

export default {
	...config,
	jsPlugins: ['@d-zero/oxlint-plugin'],
	rules: {
		...config.rules,
		// The types live in TypeScript; do not make JSDoc restate them.
		'jsdoc/require-param-type': 'off',
		'jsdoc/require-param-description': 'off',
		'jsdoc/require-returns': 'off',
		'jsdoc/require-returns-type': 'off',
		'jsdoc/require-returns-description': 'off',
		'unicorn/prefer-event-target': 'off',
		'typescript/no-floating-promises': 'error',
	},
	ignorePatterns: [
		...config.ignorePatterns,
		'**/dist/**',
		'**/target/**',
		'**/storybook-static/**',
		'packages/@nitpicker/archive/src/template-classification/page-cluster/__fixtures__/**',
		'packages/@nitpicker/archive/src/template-classification/golden/__golden__/**',
		'.agents/**',
		// Nested git worktrees of other sessions hold full copies of the repository.
		'.claude/worktrees/**',
	],
	overrides: [
		{
			files: ['.textlintrc.js'],
			rules: {
				'typescript/no-require-imports': 'off',
				'typescript/no-var-requires': 'off',
				'unicorn/prefer-module': 'off',
			},
		},
		{
			// Tests reference mocked methods as values (`expect(fake.close)`) and stub
			// async signatures with synchronous bodies, which these two rules forbid.
			files: [
				'**/*.spec.{ts,tsx,js,mjs}',
				'**/*.e2e.ts',
				'**/*.api.ts',
				'**/test-helpers/**',
				'**/__tests__/**',
			],
			rules: {
				'typescript/unbound-method': 'off',
				'typescript/require-await': 'off',
			},
		},
		{
			// Maintenance and benchmark scripts are CLI tools: stdout is their interface.
			files: [
				'scripts/**',
				'packages/@nitpicker/core/scripts/**',
				'.claude/skills/*/scripts/**',
			],
			rules: {
				'no-console': 'off',
			},
		},
		{
			files: ['packages/@nitpicker/viewer/web/**/*.{ts,tsx,js,jsx}'],
			plugins: [...config.plugins, 'react', 'jsx-a11y'],
			rules: {
				...viewerReactRules,
				'@d-zero/no-click-event': 'warn',
			},
		},
		{
			// Must come after the viewer override above: later overrides win.
			// These tables are laid out with flexbox, which strips the native table
			// semantics from the accessibility tree; the explicit `table`/`row`/
			// `columnheader` roles restore them (see the comment above each `<table>`).
			// Oxlint's jsx-a11y flags them as redundant and treats `tr` as interactive.
			files: [
				'packages/@nitpicker/viewer/web/components/paged-table.tsx',
				'packages/@nitpicker/viewer/web/components/virtual-table.tsx',
			],
			plugins: [...config.plugins, 'react', 'jsx-a11y'],
			rules: {
				'jsx-a11y/no-redundant-roles': 'off',
				'jsx-a11y/no-interactive-element-to-noninteractive-role': 'off',
			},
		},
	],
};
