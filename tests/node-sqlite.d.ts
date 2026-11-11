// Minimal typing for node:sqlite (built into Node 22.5+), which the
// project's @types/node (v20) predates. Only what the tests use.
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean; open?: boolean; enableForeignKeyConstraints?: boolean });
    exec(sql: string): void;
    close(): void;
    prepare(sql: string): {
      all(...params: unknown[]): unknown[];
      get(...params: unknown[]): unknown;
      run(...params: unknown[]): { changes: number | bigint };
    };
  }
}
