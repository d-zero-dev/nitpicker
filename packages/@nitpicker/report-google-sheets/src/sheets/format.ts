import type { sheets_v4 } from 'googleapis';

export const booleanFormatError: sheets_v4.Schema$CellFormat = {
	backgroundColor: {
		red: 0.9,
	},
	textFormat: {
		foregroundColor: {
			red: 1,
			green: 1,
			blue: 1,
		},
	},
};
