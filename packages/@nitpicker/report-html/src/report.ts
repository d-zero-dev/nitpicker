import type { HtmlReportParams } from './types.js';
import type { StepContext, TaskListPipeline } from '@d-zero/dealer';

import { writeFile } from 'node:fs/promises';

import { TaskList } from '@d-zero/dealer';
import { getViewerSummary, requireViewerReadModel } from '@nitpicker/query';
import { renderHtmlReport } from '@nitpicker/viewer/report-ui';

import { collectHtmlReportPages } from './collect-html-report-pages.js';
import { openReportArchive } from './open-report-archive.js';
import { resolveDirectoryPrefixes } from './resolve-directory-prefixes.js';
import { resolveOutputPath } from './resolve-output-path.js';

/** A `write()`-only sink that renders nothing, for `params.silent`. */
const NULL_STREAM: NodeJS.WritableStream = {
	write: () => true,
	on: () => NULL_STREAM,
	off: () => NULL_STREAM,
} as unknown as NodeJS.WritableStream;

/**
 * Generates a self-contained static HTML report from a completed archive.
 *
 * Google credentials are never consulted. The summary is always archive-wide;
 * only the page table is narrowed when directory prefixes are required to
 * stay at or below 10,000 inner pages.
 * @param params - Archive path, optional output path, and directory input.
 * @returns Resolves when the HTML file has been written.
 * @example
 * ```ts
 * await report({
 *   filePath: './site.nitpicker',
 *   outputPath: './site.html',
 *   interactive: false,
 *   directoryInput: '/docs',
 * });
 * ```
 */
export async function report(params: HtmlReportParams): Promise<void> {
	await using archive = await openReportArchive(
		params.filePath,
		params.onExtractProgress,
	);
	await requireViewerReadModel(archive.accessor);

	const prefixes = await resolveDirectoryPrefixes({
		accessor: archive.accessor,
		initialInput: params.directoryInput,
		interactive: params.interactive === true,
		onWarn: params.silent
			? () => {}
			: (message) => {
					// eslint-disable-next-line no-console
					console.warn(message);
				},
	});
	const directoryPrefixes = prefixes.map((prefix) => prefix.display);
	const outputPath = resolveOutputPath(params.filePath, params.outputPath);

	let html = '';
	let pipeline: TaskListPipeline<number> = TaskList.from(0);
	pipeline = pipeline.pipe(
		'Collect pages',
		async (input: number, ctx: StepContext<number>): Promise<number> => {
			ctx.progress('reading inner pages...');
			const pages = await collectHtmlReportPages(archive.accessor, directoryPrefixes);
			const summary = await getViewerSummary(archive.accessor);
			ctx.progress(`${pages.length.toLocaleString()} pages`);
			html = renderHtmlReport({
				summary,
				pages,
				locale: 'ja',
				generatedAt: new Date().toISOString(),
				directoryPrefixes,
			});
			return input;
		},
	);
	pipeline = pipeline.pipe(
		'Write HTML',
		async (input: number, ctx: StepContext<number>): Promise<number> => {
			ctx.progress('writing...');
			await writeFile(outputPath, html, 'utf8');
			ctx.progress(outputPath);
			return input;
		},
	);

	await pipeline.run({
		stream: params.silent ? NULL_STREAM : process.stderr,
		verbose: !process.stdout.isTTY,
		keepElapsed: true,
	});

	if (!params.silent) {
		// eslint-disable-next-line no-console
		console.log(`Wrote ${outputPath}`);
	}
}
