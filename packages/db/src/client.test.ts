import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";

describe("createDb", () => {
  let container: StartedPostgreSqlContainer;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
  }, 60_000);

  afterAll(async () => {
    await container.stop();
  });

  it("conecta a um Postgres efêmero e executa uma query", async () => {
    const db = createDb(container.getConnectionUri());
    const result = await db.execute(sql`select 1 as one`);
    expect(result[0]?.one).toBe(1);
  });
});
