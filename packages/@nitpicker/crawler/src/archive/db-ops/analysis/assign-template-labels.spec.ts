import type { TemplateLabel, TemplateLabelClusterInput } from './types.js';

import { describe, expect, it } from 'vitest';

import { assignTemplateLabels } from './assign-template-labels.js';

/**
 * Builds a cluster whose pages all sit under `section` (or at the root for `''`).
 * @param section - First path segment of every member URL.
 * @param pageIds - Member page ids.
 * @returns The cluster input.
 */
function cluster(section: string, pageIds: number[]): TemplateLabelClusterInput {
	return {
		pageIds,
		urls: pageIds.map((id) =>
			section === ''
				? `https://example.com/?p=${id}`
				: `https://example.com/${section}/${id}`,
		),
	};
}

const NO_PREVIOUS = {
	previousMembership: new Map<string, number[]>(),
	previousLabels: new Map<string, TemplateLabel>(),
};

describe('assignTemplateLabels', () => {
	it('numbers a first run per section, largest cluster first', () => {
		const labels = assignTemplateLabels({
			...NO_PREVIOUS,
			clusters: new Map([
				['events-small', cluster('events', [1, 2])],
				['events-big', cluster('events', [3, 4, 5, 6])],
				['news', cluster('news', [7])],
			]),
		});
		expect(labels.get('events-big')).toEqual({ section: 'events', ordinal: 1 });
		expect(labels.get('events-small')).toEqual({ section: 'events', ordinal: 2 });
		expect(labels.get('news')).toEqual({ section: 'news', ordinal: 1 });
	});

	it('breaks a page-count tie by template key so numbering is deterministic', () => {
		const labels = assignTemplateLabels({
			...NO_PREVIOUS,
			clusters: new Map([
				['b', cluster('events', [1])],
				['a', cluster('events', [2])],
			]),
		});
		expect(labels.get('a')).toEqual({ section: 'events', ordinal: 1 });
		expect(labels.get('b')).toEqual({ section: 'events', ordinal: 2 });
	});

	it('numbers a cluster spanning several sections, or sitting at the root, site-wide', () => {
		const mixed: TemplateLabelClusterInput = {
			pageIds: [1, 2],
			urls: ['https://example.com/events/', 'https://example.com/interviews/'],
		};
		const labels = assignTemplateLabels({
			...NO_PREVIOUS,
			clusters: new Map([
				['mixed', mixed],
				['root', cluster('', [3])],
			]),
		});
		expect(labels.get('mixed')).toEqual({ section: null, ordinal: 1 });
		expect(labels.get('root')).toEqual({ section: null, ordinal: 2 });
	});

	it('treats an unparseable member URL as not pinning the cluster to a section', () => {
		const labels = assignTemplateLabels({
			...NO_PREVIOUS,
			clusters: new Map([
				['odd', { pageIds: [1, 2], urls: ['https://example.com/events/a', 'not a url'] }],
			]),
		});
		expect(labels.get('odd')).toEqual({ section: null, ordinal: 1 });
	});

	it('carries a label forward to the new cluster holding a mutual majority of its pages', () => {
		const labels = assignTemplateLabels({
			clusters: new Map([['new-key', cluster('events', [1, 2, 3, 9])]]),
			previousMembership: new Map([['old-key', [1, 2, 3, 4]]]),
			previousLabels: new Map([['old-key', { section: 'events', ordinal: 3 }]]),
		});
		expect(labels.get('new-key')).toEqual({ section: 'events', ordinal: 3 });
	});

	it('keeps the inherited section even when the members have drifted to another directory', () => {
		const labels = assignTemplateLabels({
			clusters: new Map([['new-key', cluster('news', [1, 2, 3])]]),
			previousMembership: new Map([['old-key', [1, 2, 3]]]),
			previousLabels: new Map([['old-key', { section: 'events', ordinal: 1 }]]),
		});
		expect(labels.get('new-key')).toEqual({ section: 'events', ordinal: 1 });
	});

	it('does not inherit when the overlap is half or less of the new cluster', () => {
		const labels = assignTemplateLabels({
			clusters: new Map([['new-key', cluster('events', [1, 2, 3, 4])]]),
			previousMembership: new Map([['old-key', [1, 2]]]),
			previousLabels: new Map([['old-key', { section: 'events', ordinal: 1 }]]),
		});
		expect(labels.get('new-key')).toEqual({ section: 'events', ordinal: 2 });
	});

	it('measures the old half of the majority over pages still classified, so dropped pages do not force a rename', () => {
		const labels = assignTemplateLabels({
			// 3 of the old 7 pages survive the recrawl, all still in one template.
			clusters: new Map([['new-key', cluster('events', [1, 2, 3])]]),
			previousMembership: new Map([['old-key', [1, 2, 3, 4, 5, 6, 7]]]),
			previousLabels: new Map([['old-key', { section: 'events', ordinal: 1 }]]),
		});
		expect(labels.get('new-key')).toEqual({ section: 'events', ordinal: 1 });
	});

	it('does not inherit when the overlap is half or less of the old cluster', () => {
		const labels = assignTemplateLabels({
			// Pages 3 and 4 are still classified, just elsewhere — they count
			// against the old cluster's size.
			clusters: new Map([
				['new-key', cluster('events', [1, 2])],
				['other', cluster('events', [3, 4])],
			]),
			previousMembership: new Map([['old-key', [1, 2, 3, 4]]]),
			previousLabels: new Map([['old-key', { section: 'events', ordinal: 1 }]]),
		});
		expect(labels.get('new-key')).toEqual({ section: 'events', ordinal: 2 });
		expect(labels.get('other')).toEqual({ section: 'events', ordinal: 3 });
	});

	it('on a split, the half holding most old pages keeps the label and the rest is named afresh', () => {
		const labels = assignTemplateLabels({
			clusters: new Map([
				['bigger-half', cluster('events', [1, 2, 3])],
				['smaller-half', cluster('events', [4])],
			]),
			previousMembership: new Map([['old-key', [1, 2, 3, 4]]]),
			previousLabels: new Map([['old-key', { section: 'events', ordinal: 1 }]]),
		});
		expect(labels.get('bigger-half')).toEqual({ section: 'events', ordinal: 1 });
		expect(labels.get('smaller-half')).toEqual({ section: 'events', ordinal: 2 });
	});

	it('on a merge, the label of the old cluster contributing most pages wins', () => {
		const labels = assignTemplateLabels({
			clusters: new Map([['merged', cluster('events', [1, 2, 3, 4, 5])]]),
			previousMembership: new Map([
				['old-a', [1, 2]],
				['old-b', [3, 4, 5]],
			]),
			previousLabels: new Map([
				['old-a', { section: 'events', ordinal: 1 }],
				['old-b', { section: 'events', ordinal: 2 }],
			]),
		});
		expect(labels.get('merged')).toEqual({ section: 'events', ordinal: 2 });
	});

	it('never re-issues the letter of a cluster that disappeared', () => {
		const labels = assignTemplateLabels({
			clusters: new Map([['new-key', cluster('events', [9, 10])]]),
			previousMembership: new Map([['gone', [1, 2]]]),
			previousLabels: new Map([['gone', { section: 'events', ordinal: 1 }]]),
		});
		expect(labels.get('new-key')).toEqual({ section: 'events', ordinal: 2 });
	});

	it('does not inherit from an old cluster that was never labeled', () => {
		const labels = assignTemplateLabels({
			clusters: new Map([['new-key', cluster('events', [1, 2])]]),
			previousMembership: new Map([['old-key', [1, 2]]]),
			previousLabels: new Map(),
		});
		expect(labels.get('new-key')).toEqual({ section: 'events', ordinal: 1 });
	});

	it('returns an empty map for no clusters', () => {
		expect(assignTemplateLabels({ ...NO_PREVIOUS, clusters: new Map() })).toEqual(
			new Map(),
		);
	});
});
