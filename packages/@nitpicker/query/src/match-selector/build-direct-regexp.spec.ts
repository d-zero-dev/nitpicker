import { describe, expect, it } from 'vitest';

import { buildDirectRegExp } from './build-direct-regexp.js';

/**
 * Runs the expression once and returns its capture groups.
 * @param regExp - The expression to run.
 * @param html - The markup.
 */
function groups(regExp: RegExp, html: string): (string | undefined)[] {
	regExp.lastIndex = 0;
	const match = regExp.exec(html);
	return match ? match.slice(1) : [];
}

describe('buildDirectRegExp', () => {
	const regExp = buildDirectRegExp(['<(?=img(?=[ \\t\\n\\r\\f/>]))[A-Za-z]']);

	it('is global', () => {
		expect(regExp.global).toBe(true);
	});

	it('reports a compound match through no capture group', () => {
		expect(groups(regExp, '<img>')).toEqual([undefined, undefined, undefined, undefined]);
	});

	it.each([
		['<!--', '<!-- x -->'],
		['<![CDATA[', '<![CDATA[ x ]]>'],
		['<!', '<!DOCTYPE html>'],
	])('reports %s through group 1', (opener, html) => {
		expect(groups(regExp, html)[0]).toBe(opener);
	});

	it.each([
		'script',
		'style',
		'xmp',
		'iframe',
		'noembed',
		'noframes',
		'plaintext',
		'noscript',
	])('reports the start tag of %s through group 2', (name) => {
		expect(groups(regExp, `<${name} a="b>c">x`)[1]).toBe(name);
	});

	it('reads raw text element names in any case', () => {
		expect(groups(regExp, '<SCRIPT>')[1]).toBe('SCRIPT');
	});

	it('does not take a longer name for a raw text element', () => {
		const found = groups(regExp, '<scripts>');
		expect(found[1]).toBeUndefined();
		expect(found[3]).toBe('<scripts>');
	});

	it('reports a template start tag through group 3', () => {
		expect(groups(regExp, '<template>')[2]).toBe('<template');
		expect(groups(regExp, '<TEMPLATE x>')[2]).toBe('<TEMPLATE');
	});

	it('consumes any other start tag whole through group 4, quoted values included', () => {
		expect(groups(regExp, '<a title="<img>" id=x>')[3]).toBe('<a title="<img>" id=x>');
		expect(groups(regExp, '<span>')[3]).toBe('<span>');
	});

	it('prefers the compound over the raw text branch', () => {
		const forScript = buildDirectRegExp(['<(?=script(?=[ \\t\\n\\r\\f/>]))[A-Za-z]']);
		expect(groups(forScript, '<script src="a">')[1]).toBeUndefined();
	});

	it('joins several compounds', () => {
		const both = buildDirectRegExp([
			'<(?=img(?=[ \\t\\n\\r\\f/>]))[A-Za-z]',
			'<(?=video(?=[ \\t\\n\\r\\f/>]))[A-Za-z]',
		]);
		expect(groups(both, '<video>')).toEqual([undefined, undefined, undefined, undefined]);
		expect(both.exec('<audio>')).toBeNull();
	});
});
