import { describe, it, expect } from 'vitest';

import { detectSlotsFromHtml } from './detect-slots-from-html.js';

describe('detectSlotsFromHtml', () => {
	it('returns null for empty template', () => {
		expect(detectSlotsFromHtml('')).toBeNull();
		expect(detectSlotsFromHtml('  ')).toBeNull();
	});

	it('returns null for self-closing root element', () => {
		expect(detectSlotsFromHtml('<img src="photo.jpg" />')).toBeNull();
	});

	it('returns null for void root element', () => {
		expect(detectSlotsFromHtml('<br>')).toBeNull();
		expect(detectSlotsFromHtml('<input type="text">')).toBeNull();
		expect(detectSlotsFromHtml('<hr>')).toBeNull();
	});

	it('returns null when no slot elements are found', () => {
		const template = `
			<div>
				<h1>Title</h1>
				<p>Content</p>
			</div>
		`;
		expect(detectSlotsFromHtml(template)).toBeNull();
	});

	it('returns true for default slot at root level', () => {
		const template = '<button><slot /></button>';
		expect(detectSlotsFromHtml(template)).toBe(true);
	});

	it('returns true for default slot element with closing tag at root', () => {
		const template = '<button><slot></slot></button>';
		expect(detectSlotsFromHtml(template)).toBe(true);
	});

	it('returns SlotElement[] for default slot inside nested element', () => {
		const template = `
			<div>
				<h2>Title</h2>
				<p><slot /></p>
			</div>
		`;
		const result = detectSlotsFromHtml(template);
		expect(result).toEqual([{ element: 'p' }]);
	});

	it('returns SlotElement[] for named slot inside nested element', () => {
		const template = `
			<div>
				<header><slot name="header" /></header>
				<main><slot /></main>
			</div>
		`;
		const result = detectSlotsFromHtml(template);
		expect(result).toEqual([{ element: 'header' }, { element: 'main' }]);
	});

	it('detects slots with various attribute quote styles', () => {
		const template = `
			<div>
				<section><slot name='content' /></section>
			</div>
		`;
		const result = detectSlotsFromHtml(template);
		expect(result).toEqual([{ element: 'section' }]);
	});

	it('detects Svelte 5 {@render children()} syntax', () => {
		const template = '<button>{@render children()}</button>';
		expect(detectSlotsFromHtml(template)).toBe(true);
	});

	it('detects Svelte 5 {@render children()} in nested element', () => {
		const template = `
			<div>
				<h2>Title</h2>
				<p>{@render children()}</p>
			</div>
		`;
		const result = detectSlotsFromHtml(template);
		expect(result).toEqual([{ element: 'p' }]);
	});

	it('handles Vue SFC template content', () => {
		const template = `
			<div class="card">
				<div class="card-header">
					<slot name="header" />
				</div>
				<div class="card-body">
					<slot />
				</div>
			</div>
		`;
		const result = detectSlotsFromHtml(template);
		expect(result).toEqual([
			{ element: 'div' },
			{ element: 'div' },
		]);
	});

	it('handles slot with whitespace in tag', () => {
		const template = '<button><slot  /></button>';
		expect(detectSlotsFromHtml(template)).toBe(true);
	});

	it('handles multiple slots at root level as SlotElement[]', () => {
		const template = `
			<div>
				<slot name="before" />
				<slot />
				<slot name="after" />
			</div>
		`;
		const result = detectSlotsFromHtml(template);
		// All slots are direct children of root div, but there are multiple
		expect(Array.isArray(result)).toBe(true);
		expect(result).toHaveLength(3);
	});

	it('handles self-closing custom element root as null', () => {
		const template = '<my-icon />';
		expect(detectSlotsFromHtml(template)).toBeNull();
	});

	it('handles deeply nested slot', () => {
		const template = `
			<div>
				<section>
					<article>
						<p><slot /></p>
					</article>
				</section>
			</div>
		`;
		const result = detectSlotsFromHtml(template);
		expect(result).toEqual([{ element: 'p' }]);
	});
});
