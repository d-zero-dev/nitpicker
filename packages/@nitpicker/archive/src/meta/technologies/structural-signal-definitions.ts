import type { TechnologySignalDefinition } from './types.js';

/**
 * The structural fingerprint list as JavaScript regular expressions — the
 * form that computed the `technology_signals` rows existing archives hold.
 *
 * Not on any runtime path: detection runs the Rust port
 * (`@nitpicker/core`'s `crates/nitpicker_tech_detect`, which owns the list
 * — edit it there). Excluded from the build, this file survives only as
 * the oracle `match-structural-signals-in-javascript.ts` runs, which pins
 * the port to these expressions' output: the same signals, in this order,
 * with the same evidence. A change to the Rust list that is meant to change output is
 * made here too, so the parity spec keeps comparing like with like.
 * @module
 */
export const STRUCTURAL_SIGNAL_DEFINITIONS: readonly TechnologySignalDefinition[] = [
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
];
