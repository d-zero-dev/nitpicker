import { describe, it, expect, vi } from 'vitest';

import { UrlEventBus } from './url-event-bus.js';

describe('UrlEventBus', () => {
	it('emits and receives url events', async () => {
		const emitter = new UrlEventBus();
		const handler = vi.fn();

		emitter.on('url', handler);
		await emitter.emit('url', 'https://example.com/');

		expect(handler).toHaveBeenCalledWith('https://example.com/');
	});

	it('supports multiple listeners', async () => {
		const emitter = new UrlEventBus();
		const handler1 = vi.fn();
		const handler2 = vi.fn();

		emitter.on('url', handler1);
		emitter.on('url', handler2);
		await emitter.emit('url', 'https://example.com/page');

		expect(handler1).toHaveBeenCalledOnce();
		expect(handler2).toHaveBeenCalledOnce();
	});
});
