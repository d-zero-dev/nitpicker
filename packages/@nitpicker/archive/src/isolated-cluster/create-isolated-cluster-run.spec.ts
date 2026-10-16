import { describe, it, expect } from 'vitest';

import { createIsolatedClusterRun } from './create-isolated-cluster-run.js';

// The rules are covered in `@nitpicker/core` and by the parity spec in
// `@nitpicker/query`; this checks that the archive entry point reaches the
// native run.
describe('createIsolatedClusterRun', () => {
	it('resolves an edge to a redirect source to its destination and numbers the components by candidate order', () => {
		const run = createIsolatedClusterRun([10, 20, 30, 40], [90, 20]);
		run.unionEdges([40, 90]);
		expect([...run.labels()]).toStrictEqual([0, 1, 2, 1]);
	});
});
