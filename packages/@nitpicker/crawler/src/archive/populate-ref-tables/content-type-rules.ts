import type { ContentTypeCategory } from './types.js';

/**
 * Single matcher slot for a Content-Type rule. See `@nitpicker/query`'s
 * `content-type-rules.ts` for the wider design discussion — this file only
 * carries the subset required for JS-side classification (no SQL builders,
 * which live in `@nitpicker/query`).
 */
type Matcher =
	| { readonly kind: 'exact'; readonly value: string }
	| { readonly kind: 'prefix'; readonly value: string }
	| { readonly kind: 'suffix'; readonly value: string };

/**
 * One row of the classification table: attach a category to a set of
 * matchers, all of which OR together.
 */
interface Rule {
	readonly category: Exclude<ContentTypeCategory, 'other' | 'unknown'>;
	readonly matchers: readonly Matcher[];
}

/**
 * Content-Type classification rules, evaluated in array order — first match
 * wins. Kept in lock-step with the source-of-truth table in
 * `packages/@nitpicker/query/src/content-type-rules.ts`. Do not reorder
 * without also editing the query-side copy (a drift would misroute
 * `image/svg+xml` between `image` and `xml`, etc.).
 *
 * A future cleanup can lift the rule table into `@d-zero/shared` so both
 * `@nitpicker/crawler` and `@nitpicker/query` import a single source of
 * truth; that migration is out of 0.13's scope.
 */
export const CONTENT_TYPE_RULES: readonly Rule[] = [
	{
		category: 'html',
		matchers: [
			{ kind: 'exact', value: 'text/html' },
			{ kind: 'exact', value: 'application/xhtml+xml' },
		],
	},
	{
		category: 'pdf',
		matchers: [{ kind: 'exact', value: 'application/pdf' }],
	},
	{
		category: 'csv',
		matchers: [
			{ kind: 'exact', value: 'text/csv' },
			{ kind: 'exact', value: 'application/csv' },
			{ kind: 'exact', value: 'application/x-csv' },
			{ kind: 'exact', value: 'text/tab-separated-values' },
			{ kind: 'exact', value: 'text/tsv' },
		],
	},
	{
		category: 'word',
		matchers: [
			{ kind: 'exact', value: 'application/msword' },
			{
				kind: 'exact',
				value: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			},
		],
	},
	{
		category: 'excel',
		matchers: [
			{ kind: 'exact', value: 'application/vnd.ms-excel' },
			{
				kind: 'exact',
				value: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			},
		],
	},
	{
		category: 'powerpoint',
		matchers: [
			{ kind: 'exact', value: 'application/vnd.ms-powerpoint' },
			{
				kind: 'exact',
				value:
					'application/vnd.openxmlformats-officedocument.presentationml.presentation',
			},
		],
	},
	{
		category: 'image',
		matchers: [{ kind: 'prefix', value: 'image/' }],
	},
	{
		category: 'audio',
		matchers: [{ kind: 'prefix', value: 'audio/' }],
	},
	{
		category: 'video',
		matchers: [{ kind: 'prefix', value: 'video/' }],
	},
	{
		category: 'font',
		matchers: [
			{ kind: 'prefix', value: 'font/' },
			{ kind: 'prefix', value: 'application/font-' },
			{ kind: 'exact', value: 'application/vnd.ms-fontobject' },
		],
	},
	{
		category: 'css',
		matchers: [{ kind: 'exact', value: 'text/css' }],
	},
	{
		category: 'javascript',
		matchers: [
			{ kind: 'exact', value: 'text/javascript' },
			{ kind: 'exact', value: 'application/javascript' },
			{ kind: 'exact', value: 'application/x-javascript' },
			{ kind: 'exact', value: 'application/ecmascript' },
		],
	},
	{
		category: 'json',
		matchers: [
			{ kind: 'exact', value: 'application/json' },
			{ kind: 'exact', value: 'application/yaml' },
			{ kind: 'exact', value: 'application/x-yaml' },
			{ kind: 'exact', value: 'text/yaml' },
			{ kind: 'exact', value: 'text/x-yaml' },
			{ kind: 'suffix', value: '+json' },
			{ kind: 'suffix', value: '+yaml' },
		],
	},
	{
		category: 'xml',
		matchers: [
			{ kind: 'exact', value: 'application/xml' },
			{ kind: 'exact', value: 'text/xml' },
			{ kind: 'suffix', value: '+xml' },
		],
	},
	{
		category: 'archive',
		matchers: [
			{ kind: 'exact', value: 'application/zip' },
			{ kind: 'exact', value: 'application/gzip' },
			{ kind: 'exact', value: 'application/x-gzip' },
			{ kind: 'exact', value: 'application/x-tar' },
			{ kind: 'exact', value: 'application/x-7z-compressed' },
			{ kind: 'exact', value: 'application/x-rar-compressed' },
			{ kind: 'exact', value: 'application/octet-stream' },
		],
	},
	{
		category: 'text',
		matchers: [{ kind: 'prefix', value: 'text/' }],
	},
] as const;
