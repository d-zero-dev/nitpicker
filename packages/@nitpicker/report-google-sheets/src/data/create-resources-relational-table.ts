import type { CreateSheet } from '../sheets/types.js';
import type { Cell } from '@d-zero/google-sheets';

import { pLog } from '../debug.js';
import { createCellData } from '../sheets/create-cell-data.js';
import { defaultCellFormat } from '../sheets/default-cell-format.js';
import { booleanFormatError } from '../sheets/format.js';

const log = pLog.extend('ReferrersRelationalTable');

/**
 * Creates the "Resources Relational Table" sheet configuration.
 *
 * Produces a normalized many-to-many table linking each network
 * resource (CSS, JS, images, fonts, etc.) to the pages that
 * reference it. Each row represents one page-to-resource
 * relationship with the resource's HTTP status and size metadata.
 *
 * Unlike the "Resources" sheet which shows one row per resource
 * with a referrer count, this relational table enables filtering
 * and pivot analysis -- e.g. "which pages load this broken CSS file?"
 */
export const createResourcesRelationalTable: CreateSheet = () => {
	return {
		name: 'Resources Relational Table',
		createHeaders() {
			return [
				//
				'Referred Page (From)',
				'Resource (To)',
				'Resource Status Code',
				'Resource Status Text',
				'Resource Content Type',
				'Resource Size',
			];
		},
		async eachResource(resource) {
			log(`Read: Resource referrers (Search: ${resource.url})`);

			const data: Cell[][] = [];

			const referrers = await resource.getReferrers();

			for (const url of referrers) {
				data.push([
					createCellData(
						{
							value: url,
							textFormat: { link: { uri: url } },
						},
						defaultCellFormat,
					),
					createCellData({ value: resource.url }, defaultCellFormat),
					createCellData({ value: resource.status }, defaultCellFormat),
					createCellData({ value: resource.statusText }, defaultCellFormat),
					createCellData({ value: resource.contentType }, defaultCellFormat),
					createCellData({ value: resource.contentLength }, defaultCellFormat),
				]);
			}

			return data;
		},
		async updateSheet(sheet) {
			await sheet.frozen(2, 1);

			await sheet.conditionalFormat(
				[sheet.getColNumByHeaderName('Resource Status Code')],
				{
					booleanRule: {
						condition: {
							type: 'NUMBER_GREATER_THAN_EQ',
							values: [
								{
									userEnteredValue: '400',
								},
							],
						},
						format: booleanFormatError,
					},
				},
			);

			await sheet.conditionalFormat(
				[sheet.getColNumByHeaderName('Resource Status Code')],
				{
					booleanRule: {
						condition: {
							type: 'NUMBER_NOT_BETWEEN',
							values: [
								{
									userEnteredValue: '200',
								},
								{
									userEnteredValue: '399',
								},
							],
						},
						format: booleanFormatError,
					},
				},
			);
		},
	};
};
