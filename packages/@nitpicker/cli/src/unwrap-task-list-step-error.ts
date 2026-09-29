import { TaskListStepError } from '@d-zero/dealer';

/**
 * Unwraps a `TaskListStepError` (thrown by `TaskList.run()` when one of its
 * steps fails) down to the original cause, so the operator sees the real
 * error instead of dealer's step-wrapper text. Passes any other error
 * through unchanged (issue #294).
 *
 * Mirrors the same-named private helper already duplicated in `crawl.ts`
 * and `viewer-build.ts` — kept as its own file here (rather than also
 * refactoring those two to import it) so `concat`/`split` share one
 * implementation between themselves without touching working code
 * elsewhere.
 * @param error - The error a `TaskList.run()` call rejected with.
 * @returns The unwrapped cause, or `error` itself if it isn't a `TaskListStepError`.
 */
export function unwrapTaskListStepError(error: unknown): unknown {
	return error instanceof TaskListStepError ? error.cause : error;
}
