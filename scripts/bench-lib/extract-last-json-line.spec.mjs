import { describe, it, expect } from 'vitest';

import { extractLastJsonLine } from './extract-last-json-line.mjs';

describe('extractLastJsonLine', () => {
	it('reads the only line', () => {
		expect(extractLastJsonLine('{"bench":"body-hash"}')).toEqual({ bench: 'body-hash' });
	});

	it('ignores earlier lines and trailing blank lines', () => {
		expect(extractLastJsonLine('loading...\n{"bench":"body-hash"}\n\n')).toEqual({
			bench: 'body-hash',
		});
	});

	it('rejects empty output', () => {
		expect(() => extractLastJsonLine('\n  \n')).toThrow('no output on stdout');
	});

	it('rejects a last line that is not JSON', () => {
		expect(() => extractLastJsonLine('{"bench":"body-hash"}\ndone')).toThrow(
			'the last stdout line is not JSON',
		);
	});

	it('rejects JSON that is not an object', () => {
		expect(() => extractLastJsonLine('[1, 2]')).toThrow(
			'the last stdout line is not a JSON object',
		);
	});
});
