/**
 * Maximum depth included in the initial `/api/directory-tree` load — deeper
 * levels are expanded on demand via `listDirectoryChildren`. Exported from
 * this dependency-free module (not `get-directory-tree.ts` directly, and
 * not re-exported from the main `@nitpicker/query` entry) so the viewer
 * frontend's default-expanded-by-depth policy (`directory-tree-node.tsx`)
 * can import the value without dragging the `knex`-backed query runtime
 * into its Vite bundle — see `categories.ts` for the same browser-safe
 * sub-export pattern.
 */
export const INITIAL_DIRECTORY_TREE_DEPTH = 3;
