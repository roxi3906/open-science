import type { PrismaClient } from '@prisma/client'
import { migrationSqlExecutor, type MigrationSqlClient } from '../database/migration-sql-executor'

export const CURRENT_LEDGER_NAME = '_open-science-migrations'
export const LEGACY_LEDGER_NAME = '_open_science_migrations'
export const CURRENT_LEDGER_DDL = `CREATE TABLE IF NOT EXISTS "_open-science-migrations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "checksum" TEXT NOT NULL,
  "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "_open-science-migrations-checksum-check"
    CHECK (length("checksum") = 64 AND "checksum" NOT GLOB '*[^0-9a-f]*')
)`

export async function findLedgerTable(client: MigrationSqlClient): Promise<string | undefined> {
  const tables = await client.$queryRaw<Array<{ name: string }>>`
    SELECT "name" FROM "sqlite_schema" WHERE "type" = 'table'
      AND "name" IN (${CURRENT_LEDGER_NAME}, ${LEGACY_LEDGER_NAME})`
  if (tables.length > 1)
    throw new Error('Conflicting database migration ledgers. Neither ledger was replaced.')
  return tables[0]?.name
}

// Runs only after the existing manifest, current schema, and backup handling have completed.
// The transaction copies the ledger verbatim, including its original application timestamps.
export async function migrateLedgerIdentity(client: PrismaClient): Promise<void> {
  if ((await findLedgerTable(client)) !== LEGACY_LEDGER_NAME) return
  await client.$transaction(async (tx) => {
    if ((await findLedgerTable(tx)) !== LEGACY_LEDGER_NAME) return
    await migrationSqlExecutor.execute(tx, CURRENT_LEDGER_DDL)
    await migrationSqlExecutor.execute(
      tx,
      `INSERT INTO "_open-science-migrations" ("id", "checksum", "appliedAt")
      SELECT "id", "checksum", "appliedAt" FROM "_open_science_migrations"`
    )
    const mismatch = await migrationSqlExecutor.query<unknown[]>(
      tx,
      `
      SELECT * FROM "_open_science_migrations" EXCEPT SELECT * FROM "_open-science-migrations"`
    )
    if (mismatch.length) throw new Error('Database ledger migration verification failed.')
    await migrationSqlExecutor.execute(tx, 'DROP TABLE "_open_science_migrations"')
  })
}
