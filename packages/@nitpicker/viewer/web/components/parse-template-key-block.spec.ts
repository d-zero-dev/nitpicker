import { describe, expect, it } from 'vitest';

import { parseTemplateKeyBlock } from './parse-template-key-block.js';

describe('parseTemplateKeyBlock', () => {
	it('reads a css block key out of a template key', () => {
		expect(parseTemplateKeyBlock('["css:166e4235afcb8b15","cluster:0"]')).toEqual({
			blockKey: 'css:166e4235afcb8b15',
			kind: 'css',
		});
	});

	it('reads a path block key', () => {
		expect(parseTemplateKeyBlock('["path:news","cluster:2"]')).toEqual({
			blockKey: 'path:news',
			kind: 'path',
		});
	});

	it('maps the orphan-merge prefix to the orphanMerge kind', () => {
		expect(parseTemplateKeyBlock('["orphan-merge:blogs","cluster:0"]')).toEqual({
			blockKey: 'orphan-merge:blogs',
			kind: 'orphanMerge',
		});
	});

	it('keeps an empty path segment (site root) as a path block', () => {
		expect(parseTemplateKeyBlock('["path:","cluster:0"]')).toEqual({
			blockKey: 'path:',
			kind: 'path',
		});
	});

	it('yields unknown for an unrecognized prefix and for a key without a prefix', () => {
		expect(parseTemplateKeyBlock('["dom:abc","cluster:0"]')).toEqual({
			blockKey: 'dom:abc',
			kind: 'unknown',
		});
		expect(parseTemplateKeyBlock('["abc","cluster:0"]')).toEqual({
			blockKey: 'abc',
			kind: 'unknown',
		});
	});

	it('returns null for a key that is not a JSON array of strings', () => {
		expect(parseTemplateKeyBlock('not json')).toBeNull();
		expect(parseTemplateKeyBlock('{"a":1}')).toBeNull();
		expect(parseTemplateKeyBlock('[]')).toBeNull();
		expect(parseTemplateKeyBlock('[42,"cluster:0"]')).toBeNull();
		expect(parseTemplateKeyBlock('["","cluster:0"]')).toBeNull();
	});
});
