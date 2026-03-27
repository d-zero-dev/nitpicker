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
				message: 'What do you report? (space to toggle, enter to confirm)',
				name: 'sheetName',
				type: 'multiselect',
				choices: [...REPORT_SHEET_CHOICES],
				validate(value: unknown) {
					if (!Array.isArray(value) || value.length === 0) {
						return 'Select at least one sheet';
					}
					return true;
				},
			},
		])
		.catch(() => {
			process.exit(0);
		});

	if (!chosenSheets) {
		return null;
	}

	const names = chosenSheets.sheetName;
	if (!Array.isArray(names)) {
		return null;
	}

	return names;
}
