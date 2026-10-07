/**
 * Elements whose child text the HTML serialization algorithm writes out
 * literally (no `<` / `&` escaping) when scripting is enabled. Stored
 * snapshots are serialized from a JavaScript-enabled headless browser, so
 * `noscript` belongs here: `<noscript><img></noscript>` in a snapshot is a
 * text node, not an element.
 *
 * Both matching stages skip the content of these elements after judging
 * the start tag itself, so a tag-looking string inside them is never read
 * as markup.
 * @example
 * RAW_TEXT_ELEMENTS_WITH_SCRIPTING_ENABLED.has('noscript'); // true
 */
export const RAW_TEXT_ELEMENTS_WITH_SCRIPTING_ENABLED: ReadonlySet<string> = new Set([
	'script',
	'style',
	'xmp',
	'iframe',
	'noembed',
	'noframes',
	'plaintext',
	'noscript',
]);
