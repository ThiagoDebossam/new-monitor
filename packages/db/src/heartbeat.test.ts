import { describe, expect, it } from "vitest";
import type { Database } from "./client.js";
import { InvalidSlugError, normalizeMonitorSlug, recordHeartbeat, recordOffline } from "./heartbeat.js";

// Sem Testcontainers aqui de propósito: a validação de slug acontece antes de qualquer query,
// então esses casos não precisam de um Postgres real. Os cenários que tocam o banco estão em
// scenarios.test.ts.
const unusedDb = undefined as unknown as Database;

describe("normalizeMonitorSlug", () => {
  it("aceita slugs alfanuméricos com hífen e normaliza para minúsculo", () => {
    expect(normalizeMonitorSlug("Api-Pagamentos")).toBe("api-pagamentos");
  });

  it("rejeita string vazia", () => {
    expect(() => normalizeMonitorSlug("")).toThrow(InvalidSlugError);
  });

  it("rejeita hífen nas pontas", () => {
    expect(() => normalizeMonitorSlug("-svc")).toThrow(InvalidSlugError);
    expect(() => normalizeMonitorSlug("svc-")).toThrow(InvalidSlugError);
  });

  it("rejeita caracteres fora de [a-z0-9-]", () => {
    expect(() => normalizeMonitorSlug("job_${uuid}")).toThrow(InvalidSlugError);
    expect(() => normalizeMonitorSlug("api pagamentos")).toThrow(InvalidSlugError);
  });

  it("rejeita mais de 64 caracteres", () => {
    expect(() => normalizeMonitorSlug("a".repeat(65))).toThrow(InvalidSlugError);
  });
});

describe("recordHeartbeat / recordOffline — validação antes de tocar o banco", () => {
  it("recordHeartbeat rejeita slug inválido sem consultar o banco", async () => {
    await expect(
      recordHeartbeat(unusedDb, {
        projectId: "00000000-0000-0000-0000-000000000000",
        monitorSlug: "job_${uuid}",
        instanceKey: "inst-1",
        sequence: 0,
      }),
    ).rejects.toThrow(InvalidSlugError);
  });

  it("recordOffline rejeita slug inválido sem consultar o banco", async () => {
    await expect(
      recordOffline(unusedDb, {
        projectId: "00000000-0000-0000-0000-000000000000",
        monitorSlug: "",
        instanceKey: "inst-1",
      }),
    ).rejects.toThrow(InvalidSlugError);
  });
});
