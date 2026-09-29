import { describe, it, expect } from 'vitest';

import { buildScopeMap } from './build-scope-map.js';

describe('buildScopeMap', () => {
	it('groups roots sharing a hostname under one entry', () => {
		const scope = buildScopeMap([
			'https://example.com/blog/',
			'https://example.com/docs/',
		]);
		expect(scope.size).toBe(1);
		expect(scope.get('example.com')).toHaveLength(2);
	});

	it('indexes roots on different hostnames separately', () => {
		const scope = buildScopeMap(['https://a.example.com/', 'https://b.example.com/']);
		expect(scope.size).toBe(2);
		expect(scope.get('a.example.com')).toHaveLength(1);
		expect(scope.get('b.example.com')).toHaveLength(1);
	});

	it('keeps a distinct port as a separate scope entry from the default port', () => {
		const scope = buildScopeMap(['https://example.com/', 'https://example.com:3000/']);
		expect(scope.get('example.com')).toHaveLength(2);
	});

	it('silently skips an unparsable root', () => {
		const scope = buildScopeMap(['not a url', 'https://example.com/']);
		expect(scope.size).toBe(1);
		expect(scope.get('example.com')).toHaveLength(1);
	});

	it('returns an empty map for an empty roots list', () => {
		expect(buildScopeMap([]).size).toBe(0);
	});
});
