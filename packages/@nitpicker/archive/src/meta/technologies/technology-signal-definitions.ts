/**
 * Fixed tables for technology detection that run in TypeScript: the
 * `<meta name="generator">` matchers, the Wappalyzer name map and the
 * confidence constants. The structural fingerprint list (URL path
 * fragments, HTML markers, scoped-attribute conventions) is not here: it
 * lives with its matcher in `@nitpicker/core`'s
 * `crates/nitpicker_tech_detect`, and precision is refined by editing it
 * there, not by runtime configuration.
 *
 * Every framework that list covers is ALSO detectable via
 * {@link WAPPALYZER_PROVIDER_TO_TECHNOLOGY} when beholder's Wappalyzer pass
 * independently reports it — the two signal sources compound in
 * `combineTechnologyConfidence` rather than one replacing the other.
 * Wappalyzer detects many more technologies than those frameworks
 * (analytics, CMSes, ...); those pass through with the provider name
 * verbatim as the technology name, uncurated.
 * @module
 */

/**
 * `<meta name="generator">` prefix matchers, checked case-insensitively
 * against `page_meta.generator` (already extracted — no new HTML scan
 * needed). Distinct from the structural fingerprint list because the match
 * strategy is prefix-on-a-known-field, not regex-over-HTML.
 */
export const GENERATOR_TECHNOLOGY_MATCHERS: ReadonlyArray<{
	technology: string;
	prefix: string;
	weight: number;
	category: string;
}> = [
	{ technology: 'Astro', prefix: 'astro', weight: 85, category: 'Static site generator' },
	{ technology: 'Nuxt', prefix: 'nuxt', weight: 85, category: 'JavaScript frameworks' },
	{
		technology: 'Gatsby',
		prefix: 'gatsby',
		weight: 85,
		category: 'Static site generator',
	},
];

/**
 * Wappalyzer provider name → normalized technology name, for the curated
 * frameworks that also have structural fingerprints. Providers
 * NOT in this map still become `page_technologies` rows — the technology
 * name is just the provider name verbatim (see `normalize-wappalyzer-entries.ts`)
 * — this map exists only to fold curated frameworks' Wappalyzer detections
 * onto the same technology name their structural signals use, so the two
 * sources compound instead of appearing as two separate rows.
 */
export const WAPPALYZER_PROVIDER_TO_TECHNOLOGY: Readonly<Record<string, string>> = {
	'Next.js': 'Next.js',
	Astro: 'Astro',
	'Vue.js': 'Vue',
	'Nuxt.js': 'Nuxt',
	Nuxt: 'Nuxt',
	Svelte: 'Svelte',
	SvelteKit: 'SvelteKit',
	Remix: 'Remix',
	Gatsby: 'Gatsby',
	Angular: 'Angular',
	AngularJS: 'Angular',
};

/** Confidence a lone `wappalyzer` signal contributes, before compounding with any structural signal. */
export const WAPPALYZER_SIGNAL_WEIGHT = 60;

/** Confidence threshold (`combineTechnologyConfidence`'s output) at or above which a `page_technologies` row is written at all. Below this, a single weak/ambiguous signal is treated as noise, not a detection. */
export const TECHNOLOGY_CONFIDENCE_THRESHOLD = 30;
