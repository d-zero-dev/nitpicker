import type { ColumnDef } from '@tanstack/react-table';

/** Minimal row shape shared by the DataTable/PagedTable/VirtualTable demo stories. */
export interface DemoRow {
	/** A fake page URL. */
	url: string;
	/** A fake HTTP status, `404` every 7th row so status styling has something to show. */
	status: number;
	/** A fake page title. */
	title: string;
}

/** Column definitions shared across the DataTable/PagedTable/VirtualTable demo stories. */
export const demoTableColumns: ColumnDef<DemoRow>[] = [
	{ accessorKey: 'url', header: 'URL' },
	{ accessorKey: 'status', header: 'Status' },
	{ accessorKey: 'title', header: 'Title' },
];

/**
 * Builds `count` fake rows for the DataTable/PagedTable/VirtualTable demo stories.
 * @param count - Number of rows to generate.
 * @returns The generated demo rows.
 */
export function buildDemoRows(count: number): DemoRow[] {
	return Array.from({ length: count }, (_, i) => ({
		url: `https://example.com/page-${i + 1}`,
		status: i % 7 === 0 ? 404 : 200,
		title: `Sample page ${i + 1}`,
	}));
}
