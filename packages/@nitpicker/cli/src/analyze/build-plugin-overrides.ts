import type { PluginOverrides } from '@nitpicker/core';

/**
 * Options extracted from CLI flags that map to plugin settings.
 */
interface PluginOptionFlags {
	/** Keywords for analyze-search plugin. */
	readonly searchKeywords?: string[];
	/** CSS selector to narrow search scope for analyze-search plugin. */
	readonly searchScope?: string;
	/** CSS selector for main content detection in analyze-main-contents plugin. */
	readonly mainContentSelector?: string;
	/** BCP 47 language tag for analyze-axe plugin. */
	readonly axeLang?: string;
}

/**
 * Builds a {@link PluginOverrides} object from the parsed CLI flags.
 *
 * Only includes entries for plugins whose flags were actually provided,
 * so that unspecified flags do not overwrite config-file values with `undefined`.
 * @param flags - Parsed CLI flags containing plugin option fields.
 * @returns Plugin overrides to pass to {@link import('@nitpicker/core').Nitpicker.setPluginOverrides}.
 */
export function buildPluginOverrides(flags: PluginOptionFlags): PluginOverrides {
	const overrides: PluginOverrides = {};

	if (flags.searchKeywords || flags.searchScope) {
		const searchOverride: NonNullable<PluginOverrides['@nitpicker/analyze-search']> = {};
		if (flags.searchKeywords) {
			searchOverride.keywords = flags.searchKeywords;
		}
		if (flags.searchScope) {
			searchOverride.scope = flags.searchScope;
		}
		overrides['@nitpicker/analyze-search'] = searchOverride;
	}

	if (flags.mainContentSelector) {
		overrides['@nitpicker/analyze-main-contents'] = {
			mainContentSelector: flags.mainContentSelector,
		};
	}

	if (flags.axeLang) {
		overrides['@nitpicker/analyze-axe'] = {
			lang: flags.axeLang,
		};
	}

	return overrides;
}
