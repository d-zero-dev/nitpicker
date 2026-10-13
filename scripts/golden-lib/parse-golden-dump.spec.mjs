import { describe, it, expect } from 'vitest';

import { parseGoldenDump } from './parse-golden-dump.mjs';

describe('parseGoldenDump', () => {
	it('returns a well-formed dump', () => {
		const dump = {
			classifiedPageCount: 1,
			templateKeyByUrl: { 'https://golden.example/': '["path:","cluster:0"]' },
			clusterReasonJsonByTemplateKey: { '["path:","cluster:0"]': '{"memberCount":1}' },
		};

		expect(parseGoldenDump(JSON.stringify(dump))).toEqual(dump);
	});

	it('rejects a file without the page map', () => {
		expect(() =>
			parseGoldenDump(
				JSON.stringify({ classifiedPageCount: 1, clusterReasonJsonByTemplateKey: {} }),
			),
		).toThrow('Not a template-classification golden dump');
	});

	it('rejects non-string values', () => {
		expect(() =>
			parseGoldenDump(
				JSON.stringify({
					classifiedPageCount: 1,
					templateKeyByUrl: { a: 1 },
					clusterReasonJsonByTemplateKey: {},
				}),
			),
		).toThrow('Not a template-classification golden dump');
	});

	it('rejects text that is not JSON', () => {
		expect(() => parseGoldenDump('not json')).toThrow(SyntaxError);
	});
});
