import type { ContentTypeCategory } from './types.js';
import type { Knex } from 'knex';

/**
 * Phase 6-F: content-type filters run against `content_type_refs.raw` (the
 * deduped MIME dictionary that replaces the legacy inline `pages.contentType`
 * / `resources.contentType` columns). Callers must have joined
 * `content_type_refs as ctr` before invoking any function in this module —
 * see `applyCategoryFilter`'s doc for the assumed JOIN shape.
 */
const CONTENT_TYPE_COLUMN = 'ctr.raw';

/**
 * One matcher for a Content-Type rule. Matchers are evaluated against the
 * normalized MIME (lower-cased, parameters stripped).
 *
 * - `exact` — the MIME equals `value`
 * - `prefix` — the MIME starts with `value` (typically a leading `image/` style)
 * - `suffix` — the MIME ends with `value` (used for the `+json` / `+xml`
 *   structured-syntax suffixes from RFC 6838 §4.2.8)
 */
export type MimeMatcher =
	| { readonly kind: 'exact'; readonly value: string }
	| { readonly kind: 'prefix'; readonly value: string }
	| { readonly kind: 'suffix'; readonly value: string };

/**
 * A single Content-Type classification rule. Each rule attaches a category
 * label to a list of MIME matchers; if ANY matcher in `matchers` succeeds
 * the MIME belongs to `category`.
 *
 * Rules are evaluated in array order; the FIRST rule whose matchers fire
 * wins (this is what makes `application/xhtml+xml` → `html` and not `xml`,
 * and `image/svg+xml` → `image` and not `xml`).
 */
export interface ContentTypeRule {
	/** The canonical category this rule produces. */
	readonly category: Exclude<ContentTypeCategory, 'other' | 'unknown'>;
	/** Matchers attached to this rule; ANY-match satisfies the rule. */
	readonly matchers: readonly MimeMatcher[];
}

/**
 * The ordered Content-Type rule table — the single source of truth for both
 * the JS classifier (`classifyContentType`) and the SQL matcher used by the
 * Pages-list filter (`applyCategoryFilter`). Order encodes precedence:
 * earlier rules win over later rules on overlap, so an image/svg+xml MIME
 * is bucketed under `image` (rule order #3) rather than `xml` (rule order
 * #10) — and the SQL matcher for `xml` excludes everything earlier in the
 * list, keeping the two backends in lock-step.
 *
 * The `other` category is the implicit fall-through (no rule matched); the
 * `unknown` category covers null / empty MIMEs and lives outside this table.
 */
export const CONTENT_TYPE_RULES: readonly ContentTypeRule[] = [
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
	/* csv ahead of `text` so `text/csv` doesn't get swept up by the
	   `prefix: text/` rule below. CSV + TSV share a category (user-
	   requested grouping). */
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
	/* Microsoft Office: doc + docx merged into `word`, xls + xlsx into
	   `excel`, ppt + pptx into `powerpoint`. The .docx / .xlsx / .pptx
	   MIMEs are exact matches (long vendor strings), so they don't
	   collide with the `archive` rule's `application/octet-stream`.

	   Known ambiguity: legacy IE-friendly setups occasionally serve
	   `.csv` downloads with `application/vnd.ms-excel`. Those land
	   under `excel` here, not `csv` — by MIME there is no way to
	   tell them apart without inspecting the URL extension, which
	   the rule table deliberately avoids (MIME-only classification
	   keeps the JS classifier and the SQL matcher both pure on the
	   `contentType` column). Sites that need the .csv slice
	   separated can filter the Pages list by URL pattern. */
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
	/* json + yaml share a category (user-requested grouping). The yaml
	   exact MIMEs come ahead of the `+json` suffix branch because exact
	   wins over suffix anyway; `text/yaml` must appear before the later
	   `text` prefix rule so YAML isn't swept up as plain text. */
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

/**
 * Tests whether a normalized MIME satisfies a {@link MimeMatcher}.
 * @param mime - The normalized MIME string (lower-cased, parameters stripped).
 * @param matcher - The matcher to evaluate.
 * @returns `true` iff the MIME matches.
 */
export function matchesMime(mime: string, matcher: MimeMatcher): boolean {
	switch (matcher.kind) {
		case 'exact': {
			return mime === matcher.value;
		}
		case 'prefix': {
			return mime.startsWith(matcher.value);
		}
		case 'suffix': {
			return mime.endsWith(matcher.value);
		}
	}
}

/**
 * Applies a {@link MimeMatcher} as a POSITIVE WHERE clause on a Knex query
 * over the `contentType` column.
 * @param qb - The Knex query builder.
 * @param matcher - The matcher to translate to SQL.
 * @returns The same builder, for chaining.
 */
function applyPositiveMatcher(
	qb: Knex.QueryBuilder,
	matcher: MimeMatcher,
): Knex.QueryBuilder {
	switch (matcher.kind) {
		case 'exact': {
			return qb.where(CONTENT_TYPE_COLUMN, matcher.value);
		}
		case 'prefix': {
			return qb.where(CONTENT_TYPE_COLUMN, 'like', `${matcher.value}%`);
		}
		case 'suffix': {
			return qb.where(CONTENT_TYPE_COLUMN, 'like', `%${matcher.value}`);
		}
	}
}

/**
 * As {@link applyPositiveMatcher} but emits an OR-branch instead of a
 * top-level WHERE — used when chaining multiple matchers of a single rule.
 * @param qb - The Knex query builder.
 * @param matcher - The matcher to translate to SQL.
 * @returns The same builder, for chaining.
 */
function applyPositiveMatcherOr(
	qb: Knex.QueryBuilder,
	matcher: MimeMatcher,
): Knex.QueryBuilder {
	switch (matcher.kind) {
		case 'exact': {
			return qb.orWhere(CONTENT_TYPE_COLUMN, matcher.value);
		}
		case 'prefix': {
			return qb.orWhere(CONTENT_TYPE_COLUMN, 'like', `${matcher.value}%`);
		}
		case 'suffix': {
			return qb.orWhere(CONTENT_TYPE_COLUMN, 'like', `%${matcher.value}`);
		}
	}
}

/**
 * Applies a {@link MimeMatcher} as a NEGATIVE WHERE clause — used to exclude
 * earlier-precedence rules so a category's SQL matcher mirrors the JS
 * classifier's first-match-wins behaviour.
 * @param qb - The Knex query builder.
 * @param matcher - The matcher to negate.
 * @returns The same builder, for chaining.
 */
function applyNegativeMatcher(
	qb: Knex.QueryBuilder,
	matcher: MimeMatcher,
): Knex.QueryBuilder {
	switch (matcher.kind) {
		case 'exact': {
			return qb.whereNot(CONTENT_TYPE_COLUMN, matcher.value);
		}
		case 'prefix': {
			return qb.where(CONTENT_TYPE_COLUMN, 'not like', `${matcher.value}%`);
		}
		case 'suffix': {
			return qb.where(CONTENT_TYPE_COLUMN, 'not like', `%${matcher.value}`);
		}
	}
}

/**
 * Applies the entire `(positive of rule) OR-group` clause as a sub-clause
 * on `qb`, so the OR-branches don't escape into AND-siblings.
 * @param qb - The outer Knex query builder.
 * @param rule - The rule whose matchers form the positive group.
 */
function applyRulePositive(qb: Knex.QueryBuilder, rule: ContentTypeRule): void {
	qb.where((sub) => {
		const [first, ...rest] = rule.matchers;
		if (!first) {
			return;
		}
		applyPositiveMatcher(sub, first);
		for (const m of rest) {
			applyPositiveMatcherOr(sub, m);
		}
	});
}

/**
 * Adds NOT-clauses that exclude every matcher of `rule` from the outer
 * query (AND-combined at the outer level). Used to subtract earlier-
 * precedence rules from the current category.
 * @param qb - The outer Knex query builder.
 * @param rule - The rule whose matchers should be negated.
 */
function applyRuleNegative(qb: Knex.QueryBuilder, rule: ContentTypeRule): void {
	for (const m of rule.matchers) {
		applyNegativeMatcher(qb, m);
	}
}

/**
 * Applies a category restriction to a Knex query, mirroring the JS
 * classifier's first-match-wins semantics. The clause is wrapped in its own
 * sub-clause so combining with other WHERE filters stays AND-only.
 *
 * - For named categories (html / pdf / image / ...), this writes
 *   `positive(category) AND NOT positive(earlier-rules)`.
 * - For `other`, this writes `contentType IS NOT NULL AND contentType <> ''
 *   AND NOT positive(any-rule)` — the residual that `classifyContentType`
 *   returns when nothing else fires.
 * - For `unknown`, this writes `contentType IS NULL OR contentType = ''` —
 *   matching the classifier's handling of empty / blank MIMEs even though
 *   the writer normally normalises them to NULL.
 * @param qb - The outer Knex query builder.
 * @param category - The category to restrict to.
 */
export function applyCategoryFilter(
	qb: Knex.QueryBuilder,
	category: ContentTypeCategory,
): void {
	if (category === 'unknown') {
		qb.where((sub) => {
			sub.whereNull(CONTENT_TYPE_COLUMN).orWhere(CONTENT_TYPE_COLUMN, '');
		});
		return;
	}
	if (category === 'other') {
		qb.whereNotNull(CONTENT_TYPE_COLUMN).whereNot(CONTENT_TYPE_COLUMN, '');
		for (const rule of CONTENT_TYPE_RULES) {
			applyRuleNegative(qb, rule);
		}
		return;
	}
	const targetIndex = CONTENT_TYPE_RULES.findIndex((r) => r.category === category);
	if (targetIndex === -1) {
		throw new Error(`Unknown ContentTypeCategory: ${String(category)}`);
	}
	const target = CONTENT_TYPE_RULES[targetIndex]!;
	applyRulePositive(qb, target);
	for (let i = 0; i < targetIndex; i++) {
		applyRuleNegative(qb, CONTENT_TYPE_RULES[i]!);
	}
}
