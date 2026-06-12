import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Dev-server backend port for `/api` proxying. Override with `VITE_API_PORT`. */
const API_PORT = process.env.VITE_API_PORT ?? '4324';

/**
 * Vite configuration for the Viewer frontend SPA.
 *
 * The frontend lives in `web/` and builds to `lib/public/`, which the Hono
 * backend serves as static assets in production. During development, Vite's
 * dev server proxies `/api` to the backend; start the backend on the same
 * port (default 4324) or set `VITE_API_PORT` to match a different one.
 */
export default defineConfig({
	root: path.resolve(import.meta.dirname, 'web'),
	plugins: [react()],
	build: {
		outDir: path.resolve(import.meta.dirname, 'lib/public'),
		emptyOutDir: true,
	},
	server: {
		proxy: {
			'/api': `http://localhost:${API_PORT}`,
		},
	},
});
