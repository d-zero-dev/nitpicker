import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('assertPuppeteerSharedWithBeholder', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it('実際にインストールされた puppeteer が crawler と @d-zero/beholder で同一 install であれば何も起きない', async () => {
		const { assertPuppeteerSharedWithBeholder } =
			await import('./assert-puppeteer-shared-with-beholder.js');

		expect(() => {
			assertPuppeteerSharedWithBeholder();
		}).not.toThrow();
	});

	it('crawler と beholder の puppeteer が異なる install に解決される場合、両方のパスを含むエラーを投げる', async () => {
		vi.doMock('./find-package-dir.js', () => ({
			findPackageDir: (fromDir: string, packageName: string) => {
				if (packageName === '@d-zero/beholder') {
					return '/fake/node_modules/@d-zero/beholder';
				}
				if (packageName === 'puppeteer') {
					return fromDir === '/fake/node_modules/@d-zero/beholder'
						? '/fake/node_modules/@d-zero/beholder/node_modules/puppeteer'
						: '/fake/node_modules/puppeteer';
				}
				throw new Error(`unexpected findPackageDir call: ${packageName}`);
			},
		}));

		const { assertPuppeteerSharedWithBeholder } =
			await import('./assert-puppeteer-shared-with-beholder.js');

		expect(() => {
			assertPuppeteerSharedWithBeholder();
		}).toThrow(
			"crawler's puppeteer (/fake/node_modules/puppeteer) and @d-zero/beholder's puppeteer (/fake/node_modules/@d-zero/beholder/node_modules/puppeteer) resolve to different installs.",
		);
	});
});
