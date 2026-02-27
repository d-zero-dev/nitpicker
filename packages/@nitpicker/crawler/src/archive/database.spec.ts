import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { afterAll, describe, expect, it } from 'vitest';

import { Database } from './database.js';
import { remove } from './filesystem/index.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

afterAll(async () => {
	await remove(path.resolve(workingDir, 'tmp.sqlite'));
});

describe('Pages', () => {
	it('insert', async () => {
		const db = await Database.connect({
			type: 'sqlite3',
			workingDir,
			filename: path.resolve(workingDir, 'tmp.sqlite'),
		});

		await db.updatePage(
			{
				url: parseUrl('http://localhost/path/to')!,
				redirectPaths: [],
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentLength: 1000,
				contentType: 'html/text',
				responseHeaders: {},
				meta: {
					title: 'LOCAL_SERVER',
				},
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			},
			workingDir,
			true,
		);

		const pages = await db.getPages();

		expect(pages.length).toBe(1);
	});

	// Create mock.sqlite for the next test
	// it.skip('insert 2', async () => {
	// 	const db = await Database.connect({
	// 		type: 'sqlite3',
	// 		workingDir,
	// 		filename: path.resolve(workingDir, 'mock.sqlite'),
	// 	});

	// 	await db.updatePage(
	// 		{
	// 			url: parseUrl('http://localhost/path/to')!,
	// 			redirectPaths: ['https://localhost/path/to'],
	// 			isExternal: false,
	// 			status: 200,
	// 			statusText: 'OK',
	// 			contentLength: 1000,
	// 			contentType: 'html/text',
	// 			responseHeaders: {},
	// 			meta: {
	// 				title: 'LOCAL_SERVER',
	// 			},
	// 			anchorList: [
	// 				{
	// 					href: parseUrl('https://localhost/data/1')!,
	// 					textContent: 'DATA-1',
	// 				},
	// 				{
	// 					href: parseUrl('https://localhost/data/2')!,
	// 					textContent: 'DATA-2',
	// 				},
	// 				{
	// 					href: parseUrl('https://localhost/data/3')!,
	// 					textContent: 'DATA-3',
	// 				},
	// 				{
	// 					href: parseUrl('https://localhost/lp')!,
	// 					textContent: 'Advertisement',
	// 				},
	// 				{
	// 					href: parseUrl('https://example.com/abc')!,
	// 					textContent: 'ABC',
	// 				},
	// 				{
	// 					href: parseUrl('https://example.com/xyz')!,
	// 					textContent: 'XYZ',
	// 				},
	// 			],
	// 			imageList: [],
	// 			html: '',
	// 			isSkipped: false,
	// 		},
	// 		workingDir,
	// 		true,
	// 	);

	// 	await db.updatePage(
	// 		{
	// 			url: parseUrl('https://localhost/data/1')!,
	// 			redirectPaths: ['https://localhost/data/one'],
	// 			isExternal: false,
	// 			status: 200,
	// 			statusText: 'OK',
	// 			contentLength: 1000,
	// 			contentType: 'html/text',
	// 			responseHeaders: {},
	// 			meta: {
	// 				title: 'DATA ONE | LOCAL_SERVER',
	// 			},
	// 			anchorList: [
	// 				{
	// 					href: parseUrl('https://localhost/data/one')!,
	// 					textContent: 'DATA ONE',
	// 				},
	// 				{
	// 					href: parseUrl('https://localhost/data/two')!,
	// 					textContent: 'DATA TWO',
	// 				},
	// 				{
	// 					href: parseUrl('https://localhost/data/three')!,
	// 					textContent: 'DATA THREE',
	// 				},
	// 				{
	// 					href: parseUrl('https://localhost/lp')!,
	// 					textContent: 'Advertisement',
	// 				},
	// 				{
	// 					href: parseUrl('https://example.com/abc')!,
	// 					textContent: 'ABC',
	// 				},
	// 				{
	// 					href: parseUrl('https://example.com/xyz')!,
	// 					textContent: 'XYZ',
	// 				},
	// 			],
	// 			imageList: [],
	// 			html: '',
	// 			isSkipped: false,
	// 		},
	// 		workingDir,
	// 		true,
	// 	);

	// 	await db.updatePage(
	// 		{
	// 			url: parseUrl('https://localhost/data/2')!,
	// 			redirectPaths: ['https://localhost/data/two'],
	// 			isExternal: false,
	// 			status: 200,
	// 			statusText: 'OK',
	// 			contentLength: 1000,
	// 			contentType: 'html/text',
	// 			responseHeaders: {},
	// 			meta: {
	// 				title: 'DATA TWO | LOCAL_SERVER',
	// 			},
	// 			anchorList: [
	// 				{
	// 					href: parseUrl('https://localhost/data/one')!,
	// 					textContent: 'DATA ONE',
	// 				},
	// 				{
	// 					href: parseUrl('https://localhost/data/two')!,
	// 					textContent: 'DATA TWO',
	// 				},
	// 				{
	// 					href: parseUrl('https://localhost/data/three')!,
	// 					textContent: 'DATA THREE',
	// 				},
	// 				{
	// 					href: parseUrl('https://localhost/lp')!,
	// 					textContent: 'Advertisement',
	// 				},
	// 				{
	// 					href: parseUrl('https://example.com/abc')!,
	// 					textContent: 'ABC',
	// 				},
	// 				{
	// 					href: parseUrl('https://example.com/xyz')!,
	// 					textContent: 'XYZ',
	// 				},
	// 			],
	// 			imageList: [],
	// 			html: '',
	// 			isSkipped: false,
	// 		},
	// 		workingDir,
	// 		true,
	// 	);

	// 	await db.updatePage(
	// 		{
	// 			url: parseUrl('https://localhost/data/3')!,
	// 			redirectPaths: ['https://localhost/data/three'],
	// 			isExternal: false,
	// 			status: 200,
	// 			statusText: 'OK',
	// 			contentLength: 1000,
	// 			contentType: 'html/text',
	// 			responseHeaders: {},
	// 			meta: {
	// 				title: 'DATA THREE | LOCAL_SERVER',
	// 			},
	// 			anchorList: [
	// 				{
	// 					href: parseUrl('https://localhost/data/one')!,
	// 					textContent: 'DATA ONE',
	// 				},
	// 				{
	// 					href: parseUrl('https://localhost/data/two')!,
	// 					textContent: 'DATA TWO',
	// 				},
	// 				{
	// 					href: parseUrl('https://localhost/data/three')!,
	// 					textContent: 'DATA THREE',
	// 				},
	// 				{
	// 					href: parseUrl('https://localhost/lp')!,
	// 					textContent: 'Advertisement',
	// 				},
	// 				{
	// 					href: parseUrl('https://example.com/abc')!,
	// 					textContent: 'ABC',
	// 				},
	// 				{
	// 					href: parseUrl('https://example.com/xyz')!,
	// 					textContent: 'XYZ',
	// 				},
	// 			],
	// 			imageList: [],
	// 			html: '',
	// 			isSkipped: false,
	// 		},
	// 		workingDir,
	// 		true,
	// 	);

	// 	await db.updatePage(
	// 		{
	// 			url: parseUrl('https://localhost/lp')!,
	// 			redirectPaths: [],
	// 			isExternal: false,
	// 			status: 200,
	// 			statusText: 'OK',
	// 			contentLength: 1000,
	// 			contentType: 'html/text',
	// 			responseHeaders: {},
	// 			meta: {
	// 				title: '[AD] THE EARTH IS BLUE',
	// 			},
	// 			anchorList: [
	// 				{
	// 					href: parseUrl('https://ec.localhost/buy?id=0123')!,
	// 					textContent: 'BUY',
	// 				},
	// 			],
	// 			imageList: [],
	// 			html: '',
	// 			isSkipped: false,
	// 		},
	// 		workingDir,
	// 		true,
	// 	);

	// 	await db.updatePage(
	// 		{
	// 			url: parseUrl('https://example.com/abc')!,
	// 			redirectPaths: [],
	// 			isExternal: true,
	// 			status: 200,
	// 			statusText: 'OK',
	// 			contentLength: 1000,
	// 			contentType: 'html/text',
	// 			responseHeaders: {},
	// 			meta: {
	// 				title: 'ABC - example.com',
	// 			},
	// 			anchorList: [],
	// 			imageList: [],
	// 			html: '',
	// 			isSkipped: false,
	// 		},
	// 		workingDir,
	// 		true,
	// 	);

	// 	await db.updatePage(
	// 		{
	// 			url: parseUrl('https://example.com/xyz')!,
	// 			redirectPaths: ['https://example.com/404'],
	// 			isExternal: true,
	// 			status: 404,
	// 			statusText: 'Not Found',
	// 			contentLength: 1000,
	// 			contentType: 'html/text',
	// 			responseHeaders: {},
	// 			meta: {
	// 				title: '404 Not Found - example.com',
	// 			},
	// 			anchorList: [],
	// 			imageList: [],
	// 			html: '',
	// 			isSkipped: false,
	// 		},
	// 		workingDir,
	// 		true,
	// 	);

	// 	await db.updatePage(
	// 		{
	// 			url: parseUrl('https://ec.localhost/buy?id=0123')!,
	// 			redirectPaths: ['https://ec.localhost/items/0123/details'],
	// 			isExternal: true,
	// 			status: 200,
	// 			statusText: 'OK',
	// 			contentLength: 1000,
	// 			contentType: 'html/text',
	// 			responseHeaders: {},
	// 			meta: {
	// 				title: '[ID-0123] The tool of something | EC',
	// 			},
	// 			anchorList: [],
	// 			imageList: [],
	// 			html: '',
	// 			isSkipped: false,
	// 		},
	// 		workingDir,
	// 		true,
	// 	);
	// });

	it('get', async () => {
		const db = await Database.connect({
			type: 'sqlite3',
			workingDir,
			filename: path.resolve(workingDir, 'mock.sqlite'),
		});

		const { pages, redirects, anchors, referrers } = await db.getPagesWithRels(0, 2);

		expect(pages.map((p) => p.url)).toEqual([
			'https://localhost/data/one',
			'https://localhost/data/three',
		]);

		expect(pages.map((p) => p.title)).toEqual([
			'DATA ONE | LOCAL_SERVER',
			'DATA THREE | LOCAL_SERVER',
		]);

		expect(redirects).toEqual([
			{
				pageId: 9,
				from: 'https://localhost/data/1',
				fromId: 3,
			},
			{
				pageId: 11,
				from: 'https://localhost/data/3',
				fromId: 5,
			},
		]);

		expect(
			anchors
				.filter((a) => a.pageId === 9)
				.map((a) => ({
					url: a.url,
					href: a.href,
					title: a.title,
					textContent: a.textContent,
				})),
		).toEqual([
			{
				url: 'https://localhost/data/one',
				href: 'https://localhost/data/one',
				title: 'DATA ONE | LOCAL_SERVER',
				textContent: 'DATA ONE',
			},
			{
				url: 'https://localhost/data/two',
				href: 'https://localhost/data/two',
				title: 'DATA TWO | LOCAL_SERVER',
				textContent: 'DATA TWO',
			},
			{
				url: 'https://localhost/data/three',
				href: 'https://localhost/data/three',
				title: 'DATA THREE | LOCAL_SERVER',
				textContent: 'DATA THREE',
			},
			{
				url: 'https://localhost/lp',
				href: 'https://localhost/lp',
				title: '[AD] THE EARTH IS BLUE',
				textContent: 'Advertisement',
			},
			{
				url: 'https://example.com/abc',
				href: 'https://example.com/abc',
				title: 'ABC - example.com',
				textContent: 'ABC',
			},
			{
				url: 'https://example.com/404',
				href: 'https://example.com/xyz',
				title: '404 Not Found - example.com',
				textContent: 'XYZ',
			},
		]);

		expect(referrers.filter((r) => r.pageId === 9)).toEqual([
			{
				pageId: 9,
				url: 'https://localhost/path/to',
				through: 'https://localhost/data/1',
				throughId: 3,
				hash: null,
				textContent: 'DATA-1',
			},
			{
				pageId: 9,
				url: 'https://localhost/data/one',
				through: 'https://localhost/data/one',
				throughId: 9,
				hash: null,
				textContent: 'DATA ONE',
			},
			{
				pageId: 9,
				url: 'https://localhost/data/two',
				through: 'https://localhost/data/one',
				throughId: 9,
				hash: null,
				textContent: 'DATA ONE',
			},
			{
				pageId: 9,
				url: 'https://localhost/data/three',
				through: 'https://localhost/data/one',
				throughId: 9,
				hash: null,
				textContent: 'DATA ONE',
			},
		]);
	});

	it('getPageCount', async () => {
		const db = await Database.connect({
			type: 'sqlite3',
			workingDir,
			filename: path.resolve(workingDir, 'mock.sqlite'),
		});

		const count = await db.getPageCount();

		expect(count).toEqual(14);
	});
});
