import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, it, expect, vi } from 'vitest';

import { handleIgnoreAndSkip } from './handle-ignore-and-skip.js';

describe('handleIgnoreAndSkip', () => {
	it('calls linkList.done and returns the link when URL is in queue', () => {
		const url = parseUrl('https://example.com/page')!;
		const mockLink = { url, isExternal: false, isLowerLayer: false };
		const linkList = {
			done: vi.fn().mockReturnValue(mockLink),
		};
		const scope = new Map();
		const options = {
			interval: 0,
			parallels: 1,
			recursive: true,
			fromList: false,
			captureImages: false,
			executablePath: null,
			fetchExternal: false,
			scope: [],
			excludes: [],
			excludeKeywords: [],
			excludeUrls: [] as readonly string[],
			maxExcludedDepth: 0,
			retry: 0,
			verbose: false,
			disableQueries: false,
		};

		const result = handleIgnoreAndSkip(url, linkList as never, scope, options);

		expect(linkList.done).toHaveBeenCalledWith(url, scope, {}, options);
		expect(result).toBe(mockLink);
	});

	it('returns null when URL is not in queue', () => {
		const url = parseUrl('https://example.com/page')!;
		const linkList = {
			done: vi.fn().mockReturnValue(null),
		};
		const scope = new Map();
		const options = {
			interval: 0,
			parallels: 1,
			recursive: true,
			fromList: false,
			captureImages: false,
			executablePath: null,
			fetchExternal: false,
			scope: [],
			excludes: [],
			excludeKeywords: [],
			excludeUrls: [] as readonly string[],
			maxExcludedDepth: 0,
			retry: 0,
			verbose: false,
			disableQueries: false,
		};

		const result = handleIgnoreAndSkip(url, linkList as never, scope, options);

		expect(result).toBeNull();
	});
});
