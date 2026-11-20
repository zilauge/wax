// Minimal ambient types for Node's built-in SQLite module. The installed
// @types/node (v20) predates `node:sqlite`, but the app runs on Node 24.
declare module "node:sqlite" {
  export type RunResult = {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };

  export class StatementSync {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
