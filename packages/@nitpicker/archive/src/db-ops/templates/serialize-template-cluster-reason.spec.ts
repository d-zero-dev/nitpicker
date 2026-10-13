import { describe, expect, it } from 'vitest';

import { serializeTemplateClusterReason } from './serialize-template-cluster-reason.js';

describe('serializeTemplateClusterReason', () => {
	it('プロパティ順を保ったまま空白なしの JSON にし、小数は JavaScript の数値表記のまま出す', () => {
		const json = serializeTemplateClusterReason({
			memberCount: 3,
			blocking: [{ blockKey: 'path:news', reason: { kind: 'path', pathKey: 'news' } }],
			structuralCoreTokens: ['body>main'],
			landmarks: {
				header: {
					presenceRate: 2 / 3,
					chromeRate: 1,
					shellTokens: ['header>nav'],
					memberCountWithInstance: 2,
				},
			},
			siblingClusterKeys: [],
		});

		expect(json).toBe(
			'{"memberCount":3,"blocking":[{"blockKey":"path:news","reason":{"kind":"path","pathKey":"news"}}],"structuralCoreTokens":["body>main"],"landmarks":{"header":{"presenceRate":0.6666666666666666,"chromeRate":1,"shellTokens":["header>nav"],"memberCountWithInstance":2}},"siblingClusterKeys":[]}',
		);
	});
});
