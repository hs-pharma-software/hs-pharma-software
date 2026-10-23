// Minimal typing for node:sqlite (built into Node 22.5+), which the
// project's @types/node (v20) predates. Only what the tests use.
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      all(...params: unknown[]): unknown[];
      get(...params: unknown[]): unknown;
      run(...params: unknown[]): { changes: number | bigint };
    };
  }
}
