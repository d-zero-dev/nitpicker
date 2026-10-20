import { describe, it, expect } from 'vitest';

import { searchHtmlDocument } from './search-html-document.js';

describe('searchHtmlDocument', () => {
	it('counts the matches and cuts a snippet around the first', () => {
		const outcome = searchHtmlDocument({
			pattern: {
				source: 'a+',
				literal: false,
				ignoreCase: false,
				multiLine: false,
				dotAll: false,
			},
			html: '<p>aa b a</p>',
			snippetLength: 20,
		});
		expect(outcome).toEqual({ matchCount: 2, snippet: '<p>aa b a</p>' });
	});
});
