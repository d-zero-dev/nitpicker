/**
 * Finds where a comment, CDATA section or `<!...>` declaration ends.
 * A comment ends at the first `-->`, a CDATA section at the first `]]>`
 * and any other declaration at the first `>`; an unterminated one runs to
 * the end of the document.
 * @param options - The document and where to read.
 * @param options.html - The document.
 * @param options.opener - The text that opened it: `<!--`, `<![CDATA[` or `<!`.
 * @param options.from - The index just after `opener`.
 * @returns The index just after the declaration.
 * @example
 * skipMarkupDeclaration({ html: '<!-- <img> --><b>', opener: '<!--', from: 4 }); // 16
 */
export function skipMarkupDeclaration(options: {
	readonly html: string;
	readonly opener: string;
	readonly from: number;
}): number {
	const { html, opener, from } = options;
	const terminator = opener === '<!--' ? '-->' : opener === '<![CDATA[' ? ']]>' : '>';
	const index = html.indexOf(terminator, from);
	return index === -1 ? html.length : index + terminator.length;
}
