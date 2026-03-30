/**
 * Fixture module for runner.spec.ts tests.
 * This module exists solely so that `import(filePath)` resolves
 * to a real module. The actual default export is overridden via
 * `vi.doMock()` in the test file.
 */
export default function () {
	return { fixture: true };
}
