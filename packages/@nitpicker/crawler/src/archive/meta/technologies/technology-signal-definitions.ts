import type { TechnologySignalDefinition } from './types.js';

/**
 * Fixed fingerprint list for the frontend frameworks this module detects via
 * structural signals (URL path fragments, HTML markers, scoped-attribute
 * conventions). Deliberately a TypeScript array, not an external config
 * file (per the accepted design: precision/coverage is refined by editing
 * this file, not by runtime configuration).
 *
 * Every framework here is ALSO detectable via {@link WAPPALYZER_PROVIDER_TO_TECHNOLOGY}
 * when beholder's Wappalyzer pass independently reports it — the two signal
 * sources compound in `combineTechnologyConfidence` rather than one
 * replacing the other. Wappalyzer detects many more technologies than the
 * frameworks listed here (analytics, CMSes, ...); those pass through with
 * the provider name verbatim as the technology name, uncurated.
 * @module
 */
export const TECHNOLOGY_SIGNAL_DEFINITIONS: readonly TechnologySignalDefinition[] = [
	// Next.js
	{
		technology: 'Next.js',
		signalType: 'html-marker',
		pattern: /<script[^>]*\sid="__NEXT_DATA__"/i,
		weight: 70,
		category: 'JavaScript frameworks',
	},
	{
		technology: 'Next.js',
		signalType: 'html-marker',
		pattern: /<div[^>]*\sid="__next"/i,
		weight: 60,
		category: 'JavaScript frameworks',
	},
	{
		technology: 'Next.js',
		signalType: 'url-pattern',
		pattern: /\/_next\//,
		weight: 50,
		category: 'JavaScript frameworks',
	},
	// Astro
	{
		technology: 'Astro',
		signalType: 'html-marker',
		pattern: /<astro-island\b/i,
		weight: 65,
		category: 'Static site generator',
	},
	{
		technology: 'Astro',
		signalType: 'url-pattern',
		pattern: /\/_astro\//,
		weight: 50,
		category: 'Static site generator',
	},
	{
		technology: 'Astro',
		signalType: 'scoped-attr',
		pattern: /\sdata-astro-cid-[a-z0-9]+/i,
		weight: 40,
		category: 'Static site generator',
	},
	// Vue
	{
		technology: 'Vue',
		signalType: 'scoped-attr',
		pattern: /\sdata-v-[a-z0-9]{6,10}\b/i,
		weight: 40,
		category: 'JavaScript frameworks',
	},
	{
		technology: 'Vue',
		signalType: 'weak-marker',
		pattern: /\sid="app"/i,
		weight: 15,
		category: 'JavaScript frameworks',
	},
	{
		technology: 'Vue',
		signalType: 'js-license-comment',
		pattern: /\/\*!\s*\*\s*Vue\.js v\d/i,
		weight: 55,
		category: 'JavaScript frameworks',
	},
	// Nuxt
	{
		technology: 'Nuxt',
		signalType: 'html-marker',
		pattern: /<div[^>]*\sid="__nuxt"/i,
		weight: 60,
		category: 'JavaScript frameworks',
	},
	{
		technology: 'Nuxt',
		signalType: 'url-pattern',
		pattern: /\/_nuxt\//,
		weight: 50,
		category: 'JavaScript frameworks',
	},
	// Svelte / SvelteKit
	{
		technology: 'Svelte',
		signalType: 'scoped-attr',
		pattern: /class="[^"]*\bsvelte-[a-z0-9]{6,8}\b/i,
		weight: 40,
		category: 'JavaScript frameworks',
	},
	{
		technology: 'SvelteKit',
		signalType: 'url-pattern',
		pattern: /\/_app\/immutable\//,
		weight: 50,
		category: 'JavaScript frameworks',
	},
	// Remix
	{
		technology: 'Remix',
		signalType: 'html-marker',
		pattern: /window\.__remixContext\s*=/i,
		weight: 65,
		category: 'JavaScript frameworks',
	},
	// Gatsby
	{
		technology: 'Gatsby',
		signalType: 'html-marker',
		pattern: /<div[^>]*\sid="___gatsby"/i,
		weight: 65,
		category: 'Static site generator',
	},
	{
		technology: 'Gatsby',
		signalType: 'url-pattern',
		pattern: /\/page-data\//,
		weight: 50,
		category: 'Static site generator',
	},
	// Angular
	{
		technology: 'Angular',
		signalType: 'html-marker',
		pattern: /\sng-version="[\d.]+"/i,
		weight: 65,
		category: 'JavaScript frameworks',
	},
	{
		technology: 'Angular',
		signalType: 'scoped-attr',
		pattern: /\s_ngcontent-[a-z0-9-]+/i,
		weight: 40,
		category: 'JavaScript frameworks',
	},
] as const;

/**
 * `<meta name="generator">` prefix matchers, checked case-insensitively
 * against `page_meta.generator` (already extracted — no new HTML scan
 * needed). Distinct from {@link TECHNOLOGY_SIGNAL_DEFINITIONS} because the
 * match strategy is prefix-on-a-known-field, not regex-over-HTML.
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
 * frameworks that also have {@link TECHNOLOGY_SIGNAL_DEFINITIONS}. Providers
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
