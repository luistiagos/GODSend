import { app } from "electron";
import path from "path";
import fs from "fs";
import initSqlJs, { SqlJsStatic, Database } from "sql.js";

let _SQL: SqlJsStatic | null = null;

/**
 * Locate the sql-wasm.wasm binary across multiple possible runtime locations:
 * 1. Directly next to resolved sql.js package entry point (inside app.asar or node_modules)
 * 2. In app.asar.unpacked directory (if extracted by electron-builder)
 * 3. In app.getAppPath() node_modules
 * 4. Relative to current compiled module directory (__dirname)
 * 5. In app / resources assets folder fallback
 */
function resolveWasmBinaryPath(): string | null {
  const candidates: (string | null | undefined)[] = [
    // 1. Direct resolution relative to sql.js package
    (() => {
      try {
        const sqlJsMain = require.resolve("sql.js");
        return path.join(path.dirname(sqlJsMain), "sql-wasm.wasm");
      } catch {
        return null;
      }
    })(),
    // 2. Unpacked asar directory (if electron-builder asarUnpack extracted it)
    process.resourcesPath
      ? path.join(process.resourcesPath, "app.asar.unpacked", "node_modules", "sql.js", "dist", "sql-wasm.wasm")
      : null,
    // 3. Inside app path (app.asar or dev root)
    app?.getAppPath ? path.join(app.getAppPath(), "node_modules", "sql.js", "dist", "sql-wasm.wasm") : null,
    // 4. Relative to __dirname
    path.join(__dirname, "..", "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
    path.join(__dirname, "..", "..", "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
    // 5. Assets resource fallback
    process.resourcesPath ? path.join(process.resourcesPath, "assets", "sql-wasm.wasm") : null,
    app?.getAppPath ? path.join(app.getAppPath(), "assets", "sql-wasm.wasm") : null,
  ];

  for (const candidate of candidates) {
    if (candidate) {
      try {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch {
        // Ignore filesystem check errors and continue trying next candidates
      }
    }
  }

  return null;
}

/**
 * Return the initialised sql.js constructor, loading the WASM binary from
 * the correct location for development, packaged (asar / asar.unpacked), and portable builds.
 */
export async function getSqlJs(): Promise<SqlJsStatic> {
  if (_SQL) return _SQL;

  const wasmPath = resolveWasmBinaryPath();
  const opts: any = {};

  if (wasmPath) {
    try {
      opts.wasmBinary = fs.readFileSync(wasmPath);
    } catch {
      opts.locateFile = () => wasmPath;
    }
  }

  _SQL = await initSqlJs(opts);
  return _SQL!;
}

/**
 * Run a SQL query on the given database and return results as plain objects.
 * Uses prepare/step to avoid any pattern that triggers security linting.
 */
export function sqlQuery(db: Database, sql: string, params: any[] = []): Record<string, any>[] {
  const stmt = db.prepare(sql);
  const results: Record<string, any>[] = [];
  try {
    if (params.length) stmt.bind(params);
    while (stmt.step()) {
      results.push(stmt.getAsObject() as Record<string, any>);
    }
  } finally {
    stmt.free();
  }
  return results;
}

/**
 * Convert a sql.js db.exec() result array into plain objects (legacy helper).
 */
export function sqlRows(result: any[]): Record<string, any>[] {
  if (!result || !result[0]) return [];
  const { columns, values } = result[0];
  return (values as any[][]).map((row) => {
    const obj: Record<string, any> = {};
    columns.forEach((c: string, i: number) => { obj[c] = row[i]; });
    return obj;
  });
}

/**
 * Convert a Windows FILETIME value (100-ns ticks since 1601-01-01) to a
 * "YYYY-MM-DD" date string. Returns null for zero / out-of-range values.
 */
export function filetimeToDateStr(ft: number | bigint): string | null {
  if (!ft || ft === 0) return null;
  try {
    const ms = Number(BigInt(Math.round(Number(ft))) / 10000n) - 11644473600000;
    if (ms < 0 || ms > 9999999999999) return null;
    return new Date(ms).toISOString().split("T")[0];
  } catch { return null; }
}
