import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { safePath } from './safe-path.js';

describe('safePath', () => {
	it('resolves a valid path within the base directory', () => {
		const base = '/tmp/archive';
		const result = safePath(base, 'data', 'file.json');
		expect(result).toBe(path.resolve(base, 'data', 'file.json'));
	});

	it('throws on path traversal with ..', () => {
		const base = '/tmp/archive';
		expect(() => safePath(base, '..', 'etc', 'passwd')).toThrow(
			'Path traversal detected',
		);
	});

	it('throws on absolute path that escapes base', () => {
		const base = '/tmp/archive';
		expect(() => safePath(base, '/etc/passwd')).toThrow('Path traversal detected');
	});

	it('throws on deeply nested traversal', () => {
		const base = '/tmp/archive';
		expect(() => safePath(base, 'a', '..', '..', 'secret')).toThrow(
			'Path traversal detected',
		);
	});

	it('allows paths that resolve to the base itself', () => {
		const base = '/tmp/archive';
		const result = safePath(base, '.');
		expect(result).toBe(path.resolve(base));
	});

	it('allows nested directories within base', () => {
		const base = '/tmp/archive';
		const result = safePath(base, 'deep', 'nested', 'dir', 'file.txt');
		expect(result).toBe(path.resolve(base, 'deep', 'nested', 'dir', 'file.txt'));
	});
});
