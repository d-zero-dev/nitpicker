import { TaskListStepError } from '@d-zero/dealer';
import { describe, it, expect } from 'vitest';

import { unwrapTaskListStepError } from './unwrap-task-list-step-error.js';

describe('unwrapTaskListStepError', () => {
	it('unwraps a TaskListStepError to its original cause', () => {
		const cause = new Error('disk full');
		const wrapped = new TaskListStepError('Write archive', 3, cause);
		expect(unwrapTaskListStepError(wrapped)).toBe(cause);
	});

	it('passes a plain Error through unchanged', () => {
		const error = new Error('boom');
		expect(unwrapTaskListStepError(error)).toBe(error);
	});

	it('passes a non-Error value through unchanged', () => {
		expect(unwrapTaskListStepError('a string error')).toBe('a string error');
	});
});
