// The opening tag's attribute span is matched attribute-aware
// (`(?:"[^"]*"|'[^']*'|[^"'>])*`, not a plain `[^>]*`) so a literal `>`
// inside a quoted attribute value (e.g. `<body data-x="a>b">`) — legal HTML,
// since only the delimiting quote character itself must not appear
// unescaped inside the value — does not end the match early. A plain
// `[^>]*` would stop at that inner `>`, so the captured body would start
// mid-attribute instead of at the real content.
const BODY_PATTERN = /<body(?:"[^"]*"|'[^']*'|[^"'>])*>([\s\S]*)<\/body>/i;

/**
 * Extracts the inner HTML of the first `<body>` element from a full HTML
 * document string.
 *
 * Uses a greedy match (`[\s\S]*`, not `[\s\S]*?`) so a literal `<body>`
 * substring appearing inside the real body (e.g. an inline code sample) does
 * not truncate the extracted content at that inner occurrence — the match
 * always extends to the last `</body>` in the document.
 *
 * Falls back to returning the full input unchanged when no `<body>` tag is
 * found (fragment HTML, a page that failed to render, or a snapshot cut off
 * mid-render) rather than throwing, so callers never need a separate
 * not-found branch.
 * @param html - A full HTML document string, or a fragment.
 * @returns The content between `<body...>` and `</body>`, or `html` unchanged
 *   if no `<body>` tag is present.
 */
export function extractBody(html: string): string {
	const match = BODY_PATTERN.exec(html);
	return match?.[1] ?? html;
}
