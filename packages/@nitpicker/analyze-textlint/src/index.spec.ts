import { describe, it, expect, vi, beforeEach } from 'vitest';

const lintTextMock = vi.fn();

vi.mock('textlint', () => ({
	createLinter: vi.fn(() => ({
		lintText: lintTextMock,
	})),
}));

vi.mock('@textlint/kernel', () => ({
	TextlintKernelDescriptor: vi.fn(),
}));

// Mock all dynamic rule imports
vi.mock('textlint-rule-no-nfd', () => ({ default: {} }));
vi.mock('textlint-rule-max-ten', () => ({ default: {} }));
vi.mock('textlint-rule-spellcheck-tech-word', () => ({ default: {} }));
vi.mock('textlint-rule-web-plus-db', () => ({ default: {} }));
vi.mock('textlint-rule-no-mix-dearu-desumasu', () => ({ default: {} }));
vi.mock('textlint-rule-no-doubled-joshi', () => ({ default: {} }));
vi.mock('textlint-rule-no-double-negative-ja', () => ({ default: {} }));
vi.mock('textlint-rule-no-hankaku-kana', () => ({ default: {} }));
vi.mock('textlint-rule-ja-no-abusage', () => ({ default: {} }));
vi.mock('textlint-rule-no-mixed-zenkaku-and-hankaku-alphabet', () => ({
	default: {},
}));
vi.mock('textlint-rule-no-dropping-the-ra', () => ({ default: {} }));
vi.mock('textlint-rule-no-doubled-conjunctive-particle-ga', () => ({
	default: {},
}));
vi.mock('textlint-rule-no-doubled-conjunction', () => ({ default: {} }));
vi.mock('textlint-rule-ja-no-mixed-period', () => ({ default: {} }));
vi.mock('textlint-rule-max-appearence-count-of-words', () => ({
	default: {},
}));
vi.mock('textlint-rule-ja-hiragana-keishikimeishi', () => ({
	default: {},
}));
vi.mock('textlint-rule-ja-hiragana-fukushi', () => ({ default: {} }));
vi.mock('textlint-rule-ja-hiragana-hojodoushi', () => ({ default: {} }));
vi.mock('textlint-rule-ja-unnatural-alphabet', () => ({ default: {} }));
vi.mock('@textlint-ja/textlint-rule-no-insert-dropping-sa', () => ({
	default: {},
}));
vi.mock('textlint-rule-prefer-tari-tari', () => ({ default: {} }));
vi.mock('@textlint-ja/textlint-rule-no-synonyms', () => ({ default: {} }));
vi.mock('textlint-plugin-html', () => ({ default: {} }));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let pluginFactory: typeof import('./index.js').default;

beforeEach(async () => {
	vi.clearAllMocks();
	const mod = await import('./index.js');
	pluginFactory = mod.default;
});

describe('analyze-textlint plugin', () => {
	it('returns label', () => {
		lintTextMock.mockResolvedValue({ messages: [] });

		const plugin = pluginFactory({}, '');

		expect(plugin.label).toBe('textlint: テキスト校正');
	});

	it('returns empty violations when no issues found', async () => {
		lintTextMock.mockResolvedValue({ messages: [] });

		const plugin = pluginFactory({}, '');
		const url = new URL('https://example.com/page');
		const result = await plugin.eachPage!({
			url,
			html: '<html><body>Good text</body></html>',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(result).toEqual({ violations: [] });
	});

	it('maps textlint messages to violations', async () => {
		lintTextMock.mockResolvedValue({
			messages: [
				{
					severity: 2,
					ruleId: 'no-nfd',
					message: 'Found NFD character',
					line: 3,
					column: 10,
				},
			],
		});

		const plugin = pluginFactory({}, '');
		const url = new URL('https://example.com/page');
		const result = await plugin.eachPage!({
			url,
			html: '<html></html>',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(result!.violations).toEqual([
			{
				validator: 'textlint',
				severity: 'error',
				rule: 'no-nfd',
				code: '-',
				message: 'Found NFD character',
				url: 'https://example.com/page (3:10)',
			},
		]);
	});

	it('converts severity 1 to warning', async () => {
		lintTextMock.mockResolvedValue({
			messages: [
				{
					severity: 1,
					ruleId: 'max-ten',
					message: 'Too many commas',
					line: 1,
					column: 1,
				},
			],
		});

		const plugin = pluginFactory({}, '');
		const url = new URL('https://example.com/page');
		const result = await plugin.eachPage!({
			url,
			html: '<html></html>',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(result!.violations![0]!.severity).toBe('warning');
	});

	it('converts severity 2 to error', async () => {
		lintTextMock.mockResolvedValue({
			messages: [
				{
					severity: 2,
					ruleId: 'test-rule',
					message: 'Error',
					line: 1,
					column: 1,
				},
			],
		});

		const plugin = pluginFactory({}, '');
		const url = new URL('https://example.com/page');
		const result = await plugin.eachPage!({
			url,
			html: '<html></html>',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(result!.violations![0]!.severity).toBe('error');
	});

	it('defaults unknown severity to error', async () => {
		lintTextMock.mockResolvedValue({
			messages: [
				{
					severity: 99,
					ruleId: 'test-rule',
					message: 'Unknown severity',
					line: 1,
					column: 1,
				},
			],
		});

		const plugin = pluginFactory({}, '');
		const url = new URL('https://example.com/page');
		const result = await plugin.eachPage!({
			url,
			html: '<html></html>',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(result!.violations![0]!.severity).toBe('error');
	});

	it('passes html and url.pathname + .html to lintText', async () => {
		lintTextMock.mockResolvedValue({ messages: [] });

		const plugin = pluginFactory({}, '');
		const url = new URL('https://example.com/about');
		await plugin.eachPage!({
			url,
			html: '<p>Test</p>',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(lintTextMock).toHaveBeenCalledWith('<p>Test</p>', '/about.html');
	});

	it('merges user rules over default rules', async () => {
		lintTextMock.mockResolvedValue({ messages: [] });

		// Disable a default rule and add a custom override
		const plugin = pluginFactory(
			{
				rules: {
					'max-ten': { max: 5 },
					'spellcheck-tech-word': false,
				},
			},
			'',
		);

		const url = new URL('https://example.com/page');
		const result = await plugin.eachPage!({
			url,
			html: '<html></html>',
			window: {} as never,
			num: 0,
			total: 1,
		});

		// Verify the factory accepted the options and ran without error
		expect(result).toEqual({ violations: [] });
	});

	it('reuses linter across multiple eachPage calls (lazy singleton)', async () => {
		const { createLinter } = await import('textlint');
		lintTextMock.mockResolvedValue({ messages: [] });

		const plugin = pluginFactory({}, '');
		const url = new URL('https://example.com/page1');

		await plugin.eachPage!({
			url,
			html: '<p>Page 1</p>',
			window: {} as never,
			num: 0,
			total: 2,
		});

		await plugin.eachPage!({
			url: new URL('https://example.com/page2'),
			html: '<p>Page 2</p>',
			window: {} as never,
			num: 1,
			total: 2,
		});

		// createLinter should be called only once due to lazy singleton
		expect(createLinter).toHaveBeenCalledTimes(1);
	});

	it('collects multiple messages from a single page', async () => {
		lintTextMock.mockResolvedValue({
			messages: [
				{
					severity: 1,
					ruleId: 'rule-a',
					message: 'Warning A',
					line: 1,
					column: 1,
				},
				{
					severity: 2,
					ruleId: 'rule-b',
					message: 'Error B',
					line: 5,
					column: 3,
				},
			],
		});

		const plugin = pluginFactory({}, '');
		const url = new URL('https://example.com/page');
		const result = await plugin.eachPage!({
			url,
			html: '<html></html>',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(result!.violations).toHaveLength(2);
		expect(result!.violations![0]!.severity).toBe('warning');
		expect(result!.violations![1]!.severity).toBe('error');
	});
});
