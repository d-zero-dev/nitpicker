import { describe, expect, it, vi } from 'vitest';

import { dedupeProgressMessage } from './dedupe-progress-message.js';

describe('dedupeProgressMessage', () => {
	it('calls through on the first message', () => {
		const onMessage = vi.fn();
		const report = dedupeProgressMessage(onMessage);

		report('1/10 MB (10%)');

		expect(onMessage).toHaveBeenCalledWith('1/10 MB (10%)');
	});

	it('drops a consecutive identical message', () => {
		const onMessage = vi.fn();
		const report = dedupeProgressMessage(onMessage);

		report('1/10 MB (10%)');
		report('1/10 MB (10%)');

		expect(onMessage).toHaveBeenCalledTimes(1);
	});

	it('calls through again once the message changes', () => {
		const onMessage = vi.fn();
		const report = dedupeProgressMessage(onMessage);

		report('1/10 MB (10%)');
		report('1/10 MB (10%)');
		report('2/10 MB (20%)');

		expect(onMessage).toHaveBeenCalledTimes(2);
		expect(onMessage).toHaveBeenNthCalledWith(2, '2/10 MB (20%)');
	});

	it('re-emits a message after it changes and comes back around', () => {
		const onMessage = vi.fn();
		const report = dedupeProgressMessage(onMessage);

		report('1/10 MB (10%)');
		report('2/10 MB (20%)');
		report('2/10 MB (20%)');

		expect(onMessage).toHaveBeenCalledTimes(2);
	});
});
