import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Bundles the report renderer and its UI-only component graph for Node while
 * keeping peer-like package imports external. The `?inline` stylesheet import
 * becomes a string in the bundle, so generated reports need no asset files.
 */
export default defineConfig({
	plugins: [react()],
	build: {
		lib: {
			entry: path.resolve(import.meta.dirname, 'web/report-ui/render-html-report.tsx'),
			formats: ['es'],
			fileName: () => 'report-ui/render-html-report.js',
		},
		outDir: path.resolve(import.meta.dirname, 'lib'),
		emptyOutDir: false,
		rollupOptions: {
			external: (id) => !id.startsWith('.') && !path.isAbsolute(id),
		},
	},
});
