import { describe, it, expect, vi, beforeEach } from 'vitest';

const axeRunMock = vi.fn();
const axeConfigureMock = vi.fn();

vi.mock('axe-core', () => ({
	default: {
		run: axeRunMock,
		configure: axeConfigureMock,
	},
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let pluginFactory: typeof import('./index.js').default;

beforeEach(async () => {
	vi.clearAllMocks();
	const mod = await import('./index.js');
	pluginFactory = mod.default;
});

describe('analyze-axe plugin', () => {
	it('returns label', async () => {
		axeRunMock.mockResolvedValue({ violations: [], incomplete: [] });

		const plugin = await pluginFactory({ config: {} }, '');

		expect(plugin.label).toBe('axe: アクセシビリティチェック');
	});

	it('returns empty violations when axe finds no issues', async () => {
		axeRunMock.mockResolvedValue({ violations: [], incomplete: [] });

		const plugin = await pluginFactory({ config: {} }, '');
		const url = new URL('https://example.com');
		const result = await plugin.eachPage!({
			url,
			html: '',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(result).toEqual({ violations: [] });
	});

	it('maps violations to the expected format', async () => {
		axeRunMock.mockResolvedValue({
			violations: [
				{
					id: 'image-alt',
					impact: 'critical',
					description: 'Images must have alternate text',
					help: 'Ensure images have alt attributes',
					helpUrl: 'https://dequeuniversity.com/rules/axe/image-alt',
					nodes: [{ html: '<img src="logo.png">' }],
				},
			],
			incomplete: [],
		});

		const plugin = await pluginFactory({ config: {} }, '');
		const url = new URL('https://example.com/page');
		const result = await plugin.eachPage!({
			url,
			html: '',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(result!.violations).toEqual([
			{
				validator: 'axe',
				severity: 'critical',
				rule: 'image-alt',
				code: '<img src="logo.png">',
				message:
					'Images must have alternate text Ensure images have alt attributes(https://dequeuniversity.com/rules/axe/image-alt)',
				url: 'https://example.com/page',
			},
		]);
	});

	it('collects both violations and incomplete results', async () => {
		axeRunMock.mockResolvedValue({
			violations: [
				{
					id: 'rule-a',
					impact: 'serious',
					description: 'Violation A',
					help: '',
					helpUrl: '',
					nodes: [],
				},
			],
			incomplete: [
				{
					id: 'rule-b',
					impact: 'moderate',
					description: 'Incomplete B',
					help: '',
					helpUrl: '',
					nodes: [],
				},
			],
		});

		const plugin = await pluginFactory({ config: {} }, '');
		const url = new URL('https://example.com');
		const result = await plugin.eachPage!({
			url,
			html: '',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(result!.violations).toHaveLength(2);
		expect(result!.violations![0]!.rule).toBe('rule-b');
		expect(result!.violations![1]!.rule).toBe('rule-a');
	});

	it('skips entries with null impact', async () => {
		axeRunMock.mockResolvedValue({
			violations: [
				{
					id: 'null-impact-rule',
					impact: null,
					description: 'Should be skipped',
				},
				{
					id: 'valid-rule',
					impact: 'minor',
					description: 'Should remain',
					help: '',
					helpUrl: '',
					nodes: [],
				},
			],
			incomplete: [
				{
					id: 'null-incomplete',
					impact: null,
					description: 'Also skipped',
				},
			],
		});

		const plugin = await pluginFactory({ config: {} }, '');
		const url = new URL('https://example.com');
		const result = await plugin.eachPage!({
			url,
			html: '',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(result!.violations).toHaveLength(1);
		expect(result!.violations![0]!.rule).toBe('valid-rule');
	});

	it('handles axe.run() throwing an error', async () => {
		axeRunMock.mockRejectedValue(new Error('axe crashed'));

		const plugin = await pluginFactory({ config: {} }, '');
		const url = new URL('https://example.com');
		const result = await plugin.eachPage!({
			url,
			html: '',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(result!.violations).toHaveLength(1);
		expect(result!.violations![0]!.severity).toBe('error');
		expect(result!.violations![0]!.message).toContain('axe crashed');
	});

	it('falls back silently when locale import fails for unknown lang', async () => {
		axeRunMock.mockResolvedValue({ violations: [], incomplete: [] });

		// Use a nonexistent locale that will trigger the catch fallback
		const plugin = await pluginFactory({ lang: 'xx-nonexistent', config: {} }, '');

		const url = new URL('https://example.com');
		const result = await plugin.eachPage!({
			url,
			html: '',
			window: {} as never,
			num: 0,
			total: 1,
		});

		// Locale import failed, so axe.configure should NOT be called
		expect(axeConfigureMock).not.toHaveBeenCalled();
		expect(result).toEqual({ violations: [] });
	});

	it('calls axe.configure with locale when lang resolves successfully', async () => {
		axeRunMock.mockResolvedValue({ violations: [], incomplete: [] });

		// 'ja' locale exists in axe-core/locales/
		const plugin = await pluginFactory({ lang: 'ja', config: {} }, '');

		await plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(axeConfigureMock).toHaveBeenCalledTimes(1);
		expect(axeConfigureMock).toHaveBeenCalledWith({
			locale: expect.objectContaining({ lang: 'ja' }),
		});
	});

	it('does not call axe.configure when lang option is omitted', async () => {
		axeRunMock.mockResolvedValue({ violations: [], incomplete: [] });

		const plugin = await pluginFactory({ config: {} }, '');
		await plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(axeConfigureMock).not.toHaveBeenCalled();
	});

	it('disables the color-contrast rule in axe.run()', async () => {
		axeRunMock.mockResolvedValue({ violations: [], incomplete: [] });

		const plugin = await pluginFactory({ config: {} }, '');
		await plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(axeRunMock).toHaveBeenCalledWith({
			rules: { 'color-contrast': { enabled: false } },
		});
	});

	it('uses "error" severity for non-string impact values', async () => {
		axeRunMock.mockResolvedValue({
			violations: [
				{
					id: 'weird-impact',
					impact: 42,
					description: 'Non-string impact',
					help: '',
					helpUrl: '',
					nodes: [],
				},
			],
			incomplete: [],
		});

		const plugin = await pluginFactory({ config: {} }, '');
		const url = new URL('https://example.com');
		const result = await plugin.eachPage!({
			url,
			html: '',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(result!.violations![0]!.severity).toBe('error');
	});

	it('uses UNKNOWN_RULE when id is missing', async () => {
		axeRunMock.mockResolvedValue({
			violations: [
				{
					impact: 'minor',
					description: 'No id',
					nodes: [],
				},
			],
			incomplete: [],
		});

		const plugin = await pluginFactory({ config: {} }, '');
		const url = new URL('https://example.com');
		const result = await plugin.eachPage!({
			url,
			html: '',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(result!.violations![0]!.rule).toBe('UNKNOWN_RULE');
	});

	it('joins multiple node HTML fragments with newline', async () => {
		axeRunMock.mockResolvedValue({
			violations: [
				{
					id: 'multi-node',
					impact: 'serious',
					description: '',
					help: '',
					helpUrl: '',
					nodes: [{ html: '<div>A</div>' }, { html: '<div>B</div>' }],
				},
			],
			incomplete: [],
		});

		const plugin = await pluginFactory({ config: {} }, '');
		const url = new URL('https://example.com');
		const result = await plugin.eachPage!({
			url,
			html: '',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(result!.violations![0]!.code).toBe('<div>A</div>\n<div>B</div>');
	});
});
