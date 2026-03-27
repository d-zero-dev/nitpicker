import { describe, it, expect } from 'vitest';

import { escapeTsvField } from './escape-tsv-field.js';

describe('escapeTsvField', () => {
	it('leaves plain text unchanged', () => {
		expect(escapeTsvField('hello')).toBe('hello');
	});

	it('quotes fields that contain tabs', () => {
		expect(escapeTsvField('x\ty')).toBe('"x\ty"');
	});

	it('quotes fields that contain double quotes and escapes them', () => {
		expect(escapeTsvField('say "hi"')).toBe('"say ""hi"""');
	});

	it('quotes fields that contain newlines', () => {
		expect(escapeTsvField('line1\nline2')).toBe('"line1\nline2"');
	});
});
