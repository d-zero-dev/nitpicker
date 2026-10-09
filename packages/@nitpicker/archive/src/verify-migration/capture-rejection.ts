/**
 * Awaits a rejecting promise and returns the thrown value. Fails the caller
 * with a descriptive error if the promise resolves. Lets assertions treat
 * the caught value as a normal object without needing a try/catch in the
 * test body — the qa-engineer rule bans `if` / `switch` / try-catch inside
 * test code because control flow inside a test hides which assertion is
 * actually running when a check fails.
 *
 * The sentinel is a fresh `Symbol` per invocation so a genuine rejection
 * whose reason is `undefined` is still correctly distinguished from a
 * resolution to `undefined`.
 *
 * Shared by `check-reader-parity.spec.ts` and `verify-migration.spec.ts`
 * (and any future verify-migration spec that needs to inspect a rejection
 * reason). Not exported from the package — this is a test-only utility
 * kept next to its callers.
 * @param promise - The promise expected to reject.
 * @returns The rejection reason.
 * @example
 * const error = await captureRejection(verifyMigration(db));
 * expect(error).toBeInstanceOf(MigrationVerificationError);
 * expect((error as MigrationVerificationError).details.check).toContain('#1');
 */
export async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
	const sentinel: unique symbol = Symbol('did-not-throw');
	const value = await promise.then(
		() => sentinel,
		(error: unknown) => error,
	);
	if (value === sentinel) {
		throw new Error(
			'captureRejection: promise resolved but was expected to reject — the code path under test is silently succeeding',
		);
	}
	return value;
}
