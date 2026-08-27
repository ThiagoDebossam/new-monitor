import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveProjectByApiKeyMock, recordHeartbeatMock } = vi.hoisted(() => ({
  resolveProjectByApiKeyMock: vi.fn(),
  recordHeartbeatMock: vi.fn(),
}));

vi.mock("@pulse/db/api-keys", () => ({
  resolveProjectByApiKey: resolveProjectByApiKeyMock,
}));

vi.mock("@pulse/db/heartbeat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/db/heartbeat")>();
  return { ...actual, recordHeartbeat: recordHeartbeatMock };
});

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));

const { POST } = await import("./route");

function makeRequest(body: unknown, headers?: Record<string, string>): Request {
  return new Request("http://localhost/api/v1/heartbeat", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer plse_live_x", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/heartbeat", () => {
  beforeEach(() => {
    resolveProjectByApiKeyMock.mockReset();
    recordHeartbeatMock.mockReset();
  });

  it("retorna 401 sem header de autorização", async () => {
    const request = new Request("http://localhost/api/v1/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ monitor: "svc", instance: "i1", sequence: 0 }),
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(resolveProjectByApiKeyMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando falta 'monitor'", async () => {
    const response = await POST(makeRequest({ instance: "i1", sequence: 0 }));
    expect(response.status).toBe(400);
    expect(resolveProjectByApiKeyMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando falta 'sequence'", async () => {
    const response = await POST(makeRequest({ monitor: "svc", instance: "i1" }));
    expect(response.status).toBe(400);
  });

  it("retorna 401 quando a chave não resolve nenhum projeto", async () => {
    resolveProjectByApiKeyMock.mockResolvedValue(null);
    const response = await POST(makeRequest({ monitor: "svc", instance: "i1", sequence: 0 }));
    expect(response.status).toBe(401);
    expect(recordHeartbeatMock).not.toHaveBeenCalled();
  });

  it("retorna 202 com serverTime e intervalSeconds no caminho feliz", async () => {
    resolveProjectByApiKeyMock.mockResolvedValue("project-1");
    recordHeartbeatMock.mockResolvedValue({
      intervalSeconds: 30,
      serverTime: new Date("2026-01-01T00:00:00.000Z"),
    });

    const response = await POST(makeRequest({ monitor: "svc", instance: "i1", sequence: 0 }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      serverTime: "2026-01-01T00:00:00.000Z",
      intervalSeconds: 30,
    });
    expect(recordHeartbeatMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: "project-1", monitorSlug: "svc", instanceKey: "i1", sequence: 0 }),
    );
  });

  it("retorna 400 quando o slug do monitor é inválido", async () => {
    const { InvalidSlugError } = await import("@pulse/db/heartbeat");
    resolveProjectByApiKeyMock.mockResolvedValue("project-1");
    recordHeartbeatMock.mockRejectedValue(new InvalidSlugError("bad slug"));

    const response = await POST(makeRequest({ monitor: "bad slug", instance: "i1", sequence: 0 }));

    expect(response.status).toBe(400);
  });

  it("retorna 500 em erro inesperado do banco", async () => {
    resolveProjectByApiKeyMock.mockResolvedValue("project-1");
    recordHeartbeatMock.mockRejectedValue(new Error("conexão recusada"));

    const response = await POST(makeRequest({ monitor: "svc", instance: "i1", sequence: 0 }));

    expect(response.status).toBe(500);
  });
});
