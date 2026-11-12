import config from '@d-zero/oxlint-config';

/**
 * `eslint-plugin-react` / `react-hooks` / `jsx-a11y` の recommended 相当を、
 * oxlint のルール名で明示列挙する（oxlint は correctness カテゴリ以外を既定で有効にしない）。
 * oxlint に無い `react/no-deprecated` と、TypeScript では不要な `react/prop-types` は含めない。
 */
const viewerReactRules = Object.fromEntries(
	[
		'react/display-name',
		'react/exhaustive-deps',
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

export default {
	...config,
	jsPlugins: ['@d-zero/oxlint-plugin'],
	rules: {
		...config.rules,
		// 型は TypeScript が持つので JSDoc に重ねて書かせない（v5 の eslint-config も同じ 5 ルールを無効にしていた）
		'jsdoc/require-param-type': 'off',
		'jsdoc/require-param-description': 'off',
		'jsdoc/require-returns': 'off',
		'jsdoc/require-returns-type': 'off',
		'jsdoc/require-returns-description': 'off',
		'typescript/ban-ts-comment': 'off',
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
