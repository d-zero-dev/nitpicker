import lintStagedConfigGenerator from '@d-zero/lint-staged-config';

/**
 * `@d-zero/lint-staged-config` の既定マッピング（oxlint / oxfmt ベース）から、
 * このリポジトリで使う拡張子だけを写したもの。`defaultMapping` はパッケージの
 * エントリから export されていないため再利用できない。cspell は使わない。
 * pug / astro / vue / svelte のファイルは無い。
 */
const mapping = {
	cjs: ['oxlint', 'oxfmt'],
	css: ['stylelint', 'oxfmt'],
	cts: ['oxlint', 'oxfmt'],
	html: ['markuplint', 'oxfmt'],
	js: ['oxlint', 'oxfmt'],
	json: ['oxfmt'],
	jsx: ['oxlint', 'markuplint', 'oxfmt'],
	md: ['oxfmt', 'textlint'],
	mdx: ['oxfmt', 'textlint'],
	mjs: ['oxlint', 'oxfmt'],
	mts: ['oxlint', 'oxfmt'],
	ts: ['oxlint', 'oxfmt'],
	tsx: ['oxlint', 'markuplint', 'oxfmt'],
	yaml: ['oxfmt'],
	yml: ['oxfmt'],
};

export default lintStagedConfigGenerator(
	{
		ignore: [
			// page-cluster's HTML fixtures are tokenizer input (deliberately malformed
			// markup included): linting or reformatting them changes test results
			'packages/@nitpicker/archive/src/template-classification/page-cluster/__fixtures__/**',
			// Golden records are compared byte for byte against the serializer's output
			'packages/@nitpicker/archive/src/template-classification/golden/__golden__/**',
		],
	},
	mapping,
);
