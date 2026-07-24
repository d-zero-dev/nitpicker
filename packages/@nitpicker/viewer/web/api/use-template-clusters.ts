import type { TemplateClusterListResult } from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/**
 * Fetches every `page_templates.template_key` cluster's summary (page
 * count, common directory, common stylesheet set). Takes no parameters —
 * the endpoint always returns every cluster in the archive.
 * @returns The TanStack Query result for the template cluster list.
 */
export function useTemplateClusters() {
	return useQuery({
		queryKey: ['template-clusters'],
		queryFn: () => apiGet<TemplateClusterListResult>('/api/template-clusters'),
	});
}
