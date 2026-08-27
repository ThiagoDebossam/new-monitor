import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveProjectByApiKeyMock, recordOfflineMock } = vi.hoisted(() => ({
  resolveProjectByApiKeyMock: vi.fn(),
  recordOfflineMock: vi.fn(),
}));

vi.mock("@pulse/db/api-keys", () => ({
  resolveProjectByApiKey: resolveProjectByApiKeyMock,
}));

vi.mock("@pulse/db/heartbeat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/db/heartbeat")>();
  return { ...actual, recordOffline: recordOfflineMock };
});

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));

const { POST } = await import("./route");

function makeRequest(body: unknown, headers?: Record<string, string>): Request {
  return new Request("http://localhost/api/v1/heartbeat/offline", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer plse_live_x", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/heartbeat/offline", () => {
  beforeEach(() => {
    resolveProjectByApiKeyMock.mockReset();
    recordOfflineMock.mockReset();
  });

  it("retorna 401 sem header de autorização", async () => {
    const request = new Request("http://localhost/api/v1/heartbeat/offline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ monitor: "svc", instance: "i1" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("retorna 400 quando falta 'instance'", async () => {
    const response = await POST(makeRequest({ monitor: "svc" }));
    expect(response.status).toBe(400);
  });

  it("nunca abre incidente: só chama recordOffline, nunca lida com incidents (verificado por contrato)", async () => {
    resolveProjectByApiKeyMock.mockResolvedValue("project-1");
    recordOfflineMock.mockResolvedValue(undefined);

    const response = await POST(makeRequest({ monitor: "svc", instance: "i1" }));

    expect(response.status).toBe(202);
    expect(recordOfflineMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: "project-1", monitorSlug: "svc", instanceKey: "i1" }),
    );
  });

  it("retorna 401 quando a chave não resolve nenhum projeto", async () => {
    resolveProjectByApiKeyMock.mockResolvedValue(null);
    const response = await POST(makeRequest({ monitor: "svc", instance: "i1" }));
    expect(response.status).toBe(401);
    expect(recordOfflineMock).not.toHaveBeenCalled();
  });
});
