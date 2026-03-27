import enquirer from 'enquirer';

import { REPORT_SHEET_CHOICES } from './report-sheet-choice-names.js';

/**
 * Prompts for which report tabs to generate, or returns all choices when `all` is true.
 * @param all - When `true`, skip the prompt and return every `REPORT_SHEET_CHOICES` entry.
 * @returns Selected labels, or `null` when the prompt is cancelled without a selection.
 */
export async function selectReportSheetChoices(
	all: boolean,
): Promise<readonly string[] | null> {
	if (all) {
		return [...REPORT_SHEET_CHOICES];
	}

	const chosenSheets = await enquirer
		.prompt<{ sheetName: string[] }>([
			{
				message: 'What do you report?',
				name: 'sheetName',
				type: 'multiselect',
				choices: [...REPORT_SHEET_CHOICES],
			},
		])
		.catch(() => {
			process.exit(0);
		});

	if (!chosenSheets) {
		return null;
	}

	return chosenSheets.sheetName;
}
