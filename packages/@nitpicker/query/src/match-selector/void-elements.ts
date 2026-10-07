/**
 * HTML void elements — the ones the serialization algorithm writes without
 * an end tag, so they never have children in the tree.
 * @example
 * VOID_ELEMENTS.has('img'); // true
 */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
	'area',
	'base',
	'basefont',
	'bgsound',
	'br',
	'col',
	'embed',
	'frame',
	'hr',
	'img',
	'input',
	'keygen',
	'link',
	'meta',
	'param',
	'source',
	'track',
	'wbr',
]);
