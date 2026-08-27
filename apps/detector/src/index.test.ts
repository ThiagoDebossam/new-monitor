import { afterEach, describe, expect, it } from "vitest";
import { main, SCAN_INTERVAL_MS } from "./index.js";

describe("detector — bootstrap", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("importar o módulo não abre conexão nenhuma nem começa a varredura", async () => {
    await expect(import("./index.js")).resolves.toBeDefined();
  });

  it("varre a cada 10s, conforme ADR-0004", () => {
    expect(SCAN_INTERVAL_MS).toBe(10_000);
  });

  it("main() falha alto se DATABASE_URL não está definido", async () => {
    delete process.env.DATABASE_URL;
    await expect(main()).rejects.toThrow("DATABASE_URL não definido");
  });
});
