import type { Meta } from '@d-zero/beholder';

/**
 * Derives the `meta_extras` JSON payload from a beholder {@link Meta} object.
 *
 * Strategy: pass-through everything except data that lives in dedicated
 * tables (`page_jsonld`, `page_tags`) or that is debug-only
 * (`_raw`). Flat columns are intentionally **not** stripped — the modest
 * storage duplication is preferred over a fragile field-by-field denylist
 * that breaks every time beholder grows new Meta fields.
 *
 * The output is JSON-stringified by the caller (`#insertPage`) and stored in
 * `pages.meta_extras`. Consumers read it back via `get-page-detail` and the
 * Page wrapper's `metaExtras` getter.
 *
 * Plan note: "ファイルサイズが多少増えてもいいから取り出しパフォーマンスを優先" — this is exactly that
 * trade-off. Future Meta fields are auto-captured without code change.
 * @param meta - Beholder-derived metadata for the page.
 * @returns Plain object suitable for `JSON.stringify`.
 */
export function deriveMetaExtras(meta: Meta): Record<string, unknown> {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars -- we destructure to omit these from the spread
	const { jsonLd, speculationRules, tags, _raw, ...rest } = meta;
	return rest;
}
