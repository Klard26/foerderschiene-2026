import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getTableColumns, getTableName, is, Table } from "drizzle-orm";
import * as schema from "@workspace/db/schema";

// ---------------------------------------------------------------------------
// Guard test for the account-deletion wipe (DELETE /api/account/me).
//
// The account-deletion handler must clear EVERY table that holds personal data
// keyed to a single Clerk user. Three such tables (foerderschiene_reports,
// energieausweis_orders, user_roles) were once missed until the integration
// test happened to seed them. Both that test and the handler hard-code the
// table list, so a future user-keyed table can silently slip through both.
//
// This test removes that human-memory gap: it introspects the Drizzle schema
// for any table with a user/clerk-id column and fails if such a table is not
// wiped by the deletion flow (either deleted directly in account.ts, or removed
// via an ON DELETE CASCADE off a parent table that IS deleted, declared below).
//
// It imports the schema definitions only (`@workspace/db/schema`, NOT the `.`
// barrel that opens a pg Pool) and statically reads the handler source, so it
// needs no database connection.
// ---------------------------------------------------------------------------

/**
 * SQL column names that mark a row as belonging to a single Clerk user (i.e.
 * personal data that account deletion must clear). Add to this set if a new
 * convention for keying rows to a user is introduced.
 */
const USER_KEYED_COLUMNS = new Set(["user_id", "clerk_user_id", "customer_id"]);

/**
 * User-keyed tables that are intentionally NOT deleted directly in the handler
 * because an ON DELETE CASCADE off a parent (that IS deleted) removes them.
 * Map: SQL table name -> human-readable reason naming the parent table.
 *
 * Currently every user-keyed table is deleted directly, so this is empty. It
 * exists so a future cascade-covered table is a one-line, documented exception
 * rather than a silent gap. (The WattWechsel portfolio tables — objekt,
 * zaehlpunkt, vertrag, vollmacht, wechselvorgang, audit_log — cascade off the
 * `verwalter` row, but none of them carry a user-keyed column, so they are
 * never flagged here in the first place.)
 */
const CASCADE_COVERED: Record<string, string> = {};

interface UserKeyedTable {
  exportName: string;
  sqlName: string;
  columns: string[];
}

/** Enumerate every exported Drizzle table that carries a user-keyed column. */
function collectUserKeyedTables(): UserKeyedTable[] {
  const found: UserKeyedTable[] = [];
  for (const [exportName, value] of Object.entries(schema)) {
    if (!is(value, Table)) continue;
    const columns = Object.values(getTableColumns(value as never)) as {
      name: string;
    }[];
    const userColumns = columns
      .map((c) => c.name)
      .filter((name) => USER_KEYED_COLUMNS.has(name));
    if (userColumns.length > 0) {
      found.push({
        exportName,
        sqlName: getTableName(value as never),
        columns: userColumns,
      });
    }
  }
  return found;
}

const handlerSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "account.ts"),
  "utf8",
);

const userKeyedTables = collectUserKeyedTables();

/** True when account.ts deletes `exportName` directly inside the wipe. */
function isDeletedDirectly(exportName: string): boolean {
  // Matches e.g. `tx.delete(foerderschieneReportsTable)` / `db.delete(...)`.
  return new RegExp(`\\.delete\\(\\s*${exportName}\\b`).test(handlerSource);
}

describe("DELETE /api/account/me — schema deletion coverage guard", () => {
  it("detects the known user-keyed tables (guard is not vacuous)", () => {
    const sqlNames = userKeyedTables.map((t) => t.sqlName);
    // Sanity: if introspection silently returned nothing, the coverage check
    // below would pass vacuously. Anchor on a few tables we know are keyed.
    expect(sqlNames).toContain("providers");
    expect(sqlNames).toContain("bookings");
    expect(sqlNames).toContain("user_roles");
    expect(sqlNames).toContain("foerderschiene_reports");
    expect(sqlNames).toContain("energieausweis_orders");
    expect(sqlNames.length).toBeGreaterThanOrEqual(10);
  });

  it("clears every user-keyed (personal-data) table", () => {
    const uncovered = userKeyedTables.filter(
      (t) => !isDeletedDirectly(t.exportName) && !CASCADE_COVERED[t.sqlName],
    );

    const message =
      uncovered.length === 0
        ? ""
        : [
            "Account deletion (artifacts/api-server/src/routes/account.ts) does not",
            "clear the following user-keyed table(s) that hold personal data:",
            ...uncovered.map(
              (t) =>
                `  - ${t.sqlName} (export "${t.exportName}", column(s): ${t.columns.join(", ")})`,
            ),
            "",
            `Any table with a ${[...USER_KEYED_COLUMNS].join("/")} column is keyed to a`,
            "single Clerk user and MUST be wiped on account deletion. Fix by either:",
            "  1. Adding `tx.delete(<tableExport>).where(eq(<tableExport>.<col>, userId))`",
            "     to the deletion transaction in account.ts, OR",
            "  2. If the table is removed via an ON DELETE CASCADE off a parent that IS",
            "     deleted, add its SQL name to CASCADE_COVERED in this test with the",
            "     parent table named as the reason.",
          ].join("\n");

    expect(uncovered, message).toEqual([]);
  });
});
