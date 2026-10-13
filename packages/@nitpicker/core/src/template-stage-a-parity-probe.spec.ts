import { describe, it, expect } from 'vitest';

import { templateStageAParityProbe } from './template-stage-a-parity-probe.js';

describe('templateStageAParityProbe', () => {
	it('reports the tokens, landmarks and per-depth tokens of a page', () => {
		const probe = JSON.parse(
			templateStageAParityProbe(
				'<body><nav>n</nav><main><div><p>x</p></div></main></body>',
			),
		) as {
			tokens: string[];
			landmarks: unknown[];
			remainder: string;
			depthTokens: string[][];
		};
		expect(probe.tokens).toEqual(['body>nav', 'body>main>p']);
		expect(probe.landmarks).toEqual([['nav', 6, 18]]);
		expect(probe.remainder).toBe('<body><main><div><p>x</p></div></main></body>');
		expect(probe.depthTokens).toHaveLength(7);
	});
});
