import lintStagedConfigGenerator from '@d-zero/lint-staged-config';
export default lintStagedConfigGenerator({
	ignore: [
		// page-cluster's HTML fixtures are tokenizer input (deliberately malformed
		// markup included): linting or reformatting them changes test results
		'packages/@nitpicker/archive/src/template-classification/page-cluster/__fixtures__/**',
	],
});
