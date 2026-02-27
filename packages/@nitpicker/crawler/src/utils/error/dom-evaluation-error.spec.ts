import { describe, it, expect } from 'vitest';

import { DOMEvaluationError } from './dom-evaluation-error.js';

describe('DOMEvaluationError', () => {
	it('is an instance of Error', () => {
		const error = new DOMEvaluationError('test');
		expect(error).toBeInstanceOf(Error);
	});

	it('sets the message', () => {
		const error = new DOMEvaluationError('test message');
		expect(error.message).toBe('test message');
	});

	it('has the correct name', () => {
		const error = new DOMEvaluationError('test');
		expect(error.name).toBe('Error');
	});
});
