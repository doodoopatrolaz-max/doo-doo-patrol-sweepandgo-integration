export async function createPool(databaseUrl: string): Promise<any> {
  const pg = await import("pg");
  const { Pool } = pg.default ?? pg;
  return new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("railway.internal") || databaseUrl.includes("localhost")
      ? false
      : { rejectUnauthorized: false }
  });
}
