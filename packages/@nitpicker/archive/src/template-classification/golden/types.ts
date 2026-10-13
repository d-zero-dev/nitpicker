import type { ContentRootHint } from '@nitpicker/core/types';

/**
 * One page of a golden corpus, as data. Its `JSON.stringify` (field order
 * included) feeds {@link GoldenRecord.inputDigest}, so the shape is fixed;
 * `classifyGoldenCorpus` hands it to the driver with `html` behind
 * `getHtml`.
 */
export interface GoldenPage {
	readonly paths: readonly string[];
	readonly stylesheetHrefs: readonly string[];
	readonly html: string;
	readonly host?: string;
	readonly contentRoot?: ContentRootHint;
}

/**
 * The classification of one golden corpus, in the form committed under
 * `__golden__/`. Every field is something a reimplementation of the classifier
 * must reproduce exactly: the per-page template keys are what
 * `page_templates` stores, and each reason string is the exact JSON text
 * `replacePageTemplates` compresses into `page_template_clusters.reason_json`.
 */
export interface GoldenRecord {
	/**
	 * SHA-256 over the corpus, fed one `JSON.stringify(page)` line per page
	 * (no single corpus-sized string on the 20k-page corpus). A changed
	 * digest means the input changed (the generator or a fixture file), not
	 * the classifier — the record then has to be regenerated from a trusted
	 * implementation rather than compared.
	 */
	readonly inputDigest: string;
	readonly pageCount: number;
	/** Distinct template keys, in the order their first page appears. */
	readonly templateKeys: readonly string[];
	/** Per page, in corpus order: an index into `templateKeys`. */
	readonly templateKeyIndexByPage: readonly number[];
	/** Template key → `JSON.stringify(reason)`, keys in code-unit order. */
	readonly clusterReasonJsonByTemplateKey: Readonly<Record<string, string>>;
}

/**
 * Renders one page-builder content block of the synthetic site, drawing
 * its variable parts (row counts and the like) from the corpus PRNG.
 */
export interface ModuleRenderer {
	(random: () => number): string;
}

/**
 * Generation context shared by every renderer of one synthetic corpus.
 */
export interface SyntheticSiteContext {
	/** Uniform float in `[0, 1)`. */
	readonly random: () => number;
	/** Running page number, unique across the corpus. */
	readonly next: () => number;
}

/**
 * One section of the synthetic site: how many pages it gets at scale 1, and
 * how each is rendered.
 */
export interface SyntheticSection {
	readonly baseCount: number;
	/** `false` for one-off pages whose count must not grow with `scale`. */
	readonly scales: boolean;
	readonly render: (context: SyntheticSiteContext, index: number) => GoldenPage;
}

/**
 * Options of `buildSyntheticSite`.
 */
export interface SyntheticSiteOptions {
	/** Seed of the generator's PRNG; the same seed yields the same corpus. */
	readonly seed: number;
	/**
	 * Multiplies the page count of every section. `1` gives a corpus of a few
	 * hundred pages (the classifier's in-memory path); large values push it past
	 * the streaming threshold.
	 */
	readonly scale: number;
}
