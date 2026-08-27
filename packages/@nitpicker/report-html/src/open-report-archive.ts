import type { ArchiveAccessor } from '@nitpicker/crawler';

import { ArchiveManager } from '@nitpicker/query';

interface HtmlReportArchiveHandle extends AsyncDisposable {
	readonly accessor: ArchiveAccessor;
}

/**
 * Opens a completed archive through the shared read-only tar cache.
 * @param filePath - Completed `.nitpicker` archive path.
 * @param onExtractProgress - Optional extraction progress callback.
 * @returns A disposable read-only archive handle.
 */
export async function openReportArchive(
	filePath: string,
	onExtractProgress?: (readBytes: number, totalBytes: number) => void,
): Promise<HtmlReportArchiveHandle> {
	const manager = new ArchiveManager({ onExtractProgress });
	const { accessor, mode } = await manager.open(filePath);
	if (mode !== 'archive') {
		await manager.closeAll();
		throw new Error(
			`report: "${filePath}" is not a completed .nitpicker archive (detected mode: "${mode}").`,
		);
	}

	return {
		accessor,
		async [Symbol.asyncDispose]() {
			await manager.closeAll();
		},
	};
}
