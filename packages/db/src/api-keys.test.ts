import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, resolveProjectByApiKey } from "./api-keys.js";
import { createDb, type Database } from "./client.js";
import { apiKeys, organizations, projects } from "./schema.js";

describe("generateApiKey", () => {
  it("gera chaves com prefixo reconhecível e 22 caracteres de entropia (ADR-0007)", () => {
    const { key, keyHash, keyPrefix } = generateApiKey("live");
    expect(key).toMatch(/^plse_live_[A-Za-z0-9_-]{22}$/);
    expect(keyPrefix).toBe(key.slice(0, 12));
    expect(keyHash).toBe(hashApiKey(key));
  });

  it("usa o prefixo de teste quando pedido", () => {
    const { key } = generateApiKey("test");
    expect(key.startsWith("plse_test_")).toBe(true);
  });

  it("nunca gera a mesma chave duas vezes", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).not.toBe(b.key);
  });
});

describe("hashApiKey", () => {
  it("é determinístico", () => {
    expect(hashApiKey("plse_live_x")).toBe(hashApiKey("plse_live_x"));
  });

  it("nunca guarda o texto claro no hash", () => {
    expect(hashApiKey("plse_live_x")).not.toContain("plse_live_x");
  });
});

describe("resolveProjectByApiKey", () => {
  let container: StartedPostgreSqlContainer;
  let db: Database;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    db = createDb(container.getConnectionUri());
    await migrate(db, { migrationsFolder: "./migrations" });
  }, 60_000);

  afterAll(async () => {
    await container.stop();
  });

  afterEach(async () => {
    await db.execute(sql`TRUNCATE api_keys, projects, organizations RESTART IDENTITY CASCADE`);
  });

  async function seedProjectWithKey(env: "live" | "test" = "live") {
    const [org] = await db.insert(organizations).values({ name: "Acme", slug: `acme-${crypto.randomUUID()}` }).returning();
    const [project] = await db.insert(projects).values({ orgId: org!.id, name: "Default", slug: "default" }).returning();
    const generated = generateApiKey(env);
    await db.insert(apiKeys).values({
      projectId: project!.id,
      name: "chave de teste",
      keyHash: generated.keyHash,
      keyPrefix: generated.keyPrefix,
    });
    return { projectId: project!.id, rawKey: generated.key };
  }

  it("resolve o project_id de uma chave válida", async () => {
    const { projectId, rawKey } = await seedProjectWithKey();
    await expect(resolveProjectByApiKey(db, rawKey)).resolves.toBe(projectId);
  });

  it("retorna null para uma chave desconhecida", async () => {
    await expect(resolveProjectByApiKey(db, "plse_live_inexistente")).resolves.toBeNull();
  });

  it("retorna null para uma chave revogada", async () => {
    const { rawKey } = await seedProjectWithKey();
    await db.update(apiKeys).set({ revokedAt: new Date() }).where(sql`${apiKeys.keyHash} = ${hashApiKey(rawKey)}`);
    await expect(resolveProjectByApiKey(db, rawKey)).resolves.toBeNull();
  });

  it("marca last_used_at ao resolver com sucesso", async () => {
    const { rawKey } = await seedProjectWithKey();
    await resolveProjectByApiKey(db, rawKey);
    const [row] = await db.select().from(apiKeys).where(sql`${apiKeys.keyHash} = ${hashApiKey(rawKey)}`);
    expect(row?.lastUsedAt).not.toBeNull();
  });
});
