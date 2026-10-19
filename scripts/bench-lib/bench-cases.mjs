/**
 * Every baseline bench (`scripts/bench-<name>.mjs`) and its cases, in the
 * order `bench-suite.mjs` runs them — the single list both the scripts
 * (to validate `--case`) and the suite (to enumerate runs) read, so a case
 * cannot exist in one and be missing from the other. The first case is
 * each script's default.
 * @example
 * parseBenchArguments(argv, { cases: BENCH_CASES['body-hash'] });
 */
export const BENCH_CASES = Object.freeze({
	'template-classification': ['full'],
	'url-natural-sort': ['rank-map', 'all-urls'],
	'isolated-clusters': ['default'],
	'alias-backfill': ['default'],
	'get-link-graph': ['all', 'limit-500'],
	'match-selector': ['simple', 'compound', 'nth'],
	'search-html': ['literal-many', 'literal-few', 'regex-many', 'regex-few'],
	'body-hash': ['rust', 'js'],
	'tech-signals': ['rust', 'js'],
});
