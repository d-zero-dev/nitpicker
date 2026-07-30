import { describe, it, expect, vi, beforeEach } from 'vitest';

import pkg from '../../package.json' with { type: 'json' };

const mockExistsSync = vi.fn();
const mockExecutablePath = vi.fn();

vi.mock('node:fs', () => ({
	existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

vi.mock('puppeteer', () => ({
	executablePath: (...args: unknown[]) => mockExecutablePath(...args),
}));

describe('assertChromeIsInstalled', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('明示的な executablePath が存在すれば解決される（puppeteer は呼ばれない）', async () => {
		const { assertChromeIsInstalled } = await import('./assert-chrome-installed.js');
		mockExistsSync.mockReturnValue(true);

		await expect(assertChromeIsInstalled('/opt/chrome/chrome')).resolves.toBeUndefined();
		expect(mockExecutablePath).not.toHaveBeenCalled();
	});

	it('明示的な executablePath が存在しなければ、そのパスを含むエラーを投げる', async () => {
		const { assertChromeIsInstalled } = await import('./assert-chrome-installed.js');
		mockExistsSync.mockReturnValue(false);

		await expect(assertChromeIsInstalled('/opt/chrome/missing')).rejects.toThrow(
			'Executable path does not exist: /opt/chrome/missing',
		);
	});

	it('executablePath 未指定時、puppeteer が解決したパスが存在すれば解決される', async () => {
		const { assertChromeIsInstalled } = await import('./assert-chrome-installed.js');
		mockExecutablePath.mockReturnValue(
			'/home/user/.cache/puppeteer/chrome/linux-1.2.3/chrome',
		);
		mockExistsSync.mockReturnValue(true);

		await expect(assertChromeIsInstalled()).resolves.toBeUndefined();
	});

	it('executablePath が null の場合も puppeteer のデフォルト解決にフォールバックする', async () => {
		const { assertChromeIsInstalled } = await import('./assert-chrome-installed.js');
		mockExecutablePath.mockReturnValue(
			'/home/user/.cache/puppeteer/chrome/linux-1.2.3/chrome',
		);
		mockExistsSync.mockReturnValue(true);

		await expect(assertChromeIsInstalled(null)).resolves.toBeUndefined();
	});

	it('puppeteer が解決したパスが存在しなければ、インストールコマンドを含むエラーを投げる', async () => {
		const { assertChromeIsInstalled } = await import('./assert-chrome-installed.js');
		mockExecutablePath.mockReturnValue(
			'/home/user/.cache/puppeteer/chrome/linux-1.2.3/chrome',
		);
		mockExistsSync.mockReturnValue(false);

		const error = await assertChromeIsInstalled().catch(
			(error_: unknown) => error_ as Error,
		);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain(
			'Chrome executable not found at: /home/user/.cache/puppeteer/chrome/linux-1.2.3/chrome',
		);
		expect((error as Error).message).toContain(
			`npx puppeteer@${pkg.dependencies.puppeteer} browsers install chrome`,
		);
	});
});
