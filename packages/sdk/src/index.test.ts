import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { init, SDK_NAME } from "./index.js";

function fakeResponse(ok: boolean, body: unknown = {}): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

describe("@pulse/node", () => {
  it("expõe o nome do pacote", () => {
    expect(SDK_NAME).toBe("@pulse/node");
  });
});

describe("init()", () => {
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchImpl = vi.fn().mockResolvedValue(fakeResponse(true, { intervalSeconds: 30 }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("valida apiKey e monitor obrigatórios", () => {
    expect(() => init({ apiKey: "", monitor: "svc", fetchImpl })).toThrow(/apiKey/);
    expect(() => init({ apiKey: "plse_test_x", monitor: "", fetchImpl })).toThrow(/monitor/);
  });

  it("envia um heartbeat imediatamente, com os campos do contrato de ingestão", async () => {
    const handle = init({ apiKey: "plse_test_x", monitor: "api-pagamentos", fetchImpl });
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ingest.pulse.dev/api/v1/heartbeat");
    expect((requestInit.headers as Record<string, string>).authorization).toBe("Bearer plse_test_x");
    const payload = JSON.parse(requestInit.body as string);
    expect(payload).toMatchObject({ monitor: "api-pagamentos", sequence: 0, interval: 30, pid: process.pid });
    expect(typeof payload.instance).toBe("string");
    expect(payload.instance.length).toBeGreaterThan(0);

    handle.stop();
  });

  it("repete no intervalo configurado, incrementando sequence", async () => {
    const handle = init({ apiKey: "plse_test_x", monitor: "svc", intervalSeconds: 10, fetchImpl });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const sequences = fetchImpl.mock.calls.map(
      ([, reqInit]: [string, RequestInit]) => JSON.parse(reqInit.body as string).sequence,
    );
    expect(sequences).toEqual([0, 1, 2]);

    handle.stop();
  });

  it("obedece o intervalSeconds devolvido pelo servidor", async () => {
    fetchImpl.mockResolvedValue(fakeResponse(true, { intervalSeconds: 5 }));
    const handle = init({ apiKey: "plse_test_x", monitor: "svc", intervalSeconds: 30, fetchImpl });
    await vi.advanceTimersByTimeAsync(0); // primeiro heartbeat: servidor manda trocar para 5s

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    handle.stop();
  });

  it("nunca segura o event loop do cliente (timer.unref)", async () => {
    const unref = vi.fn();
    const setIntervalSpy = vi.spyOn(global, "setInterval").mockReturnValue({ unref, ref: vi.fn() } as unknown as NodeJS.Timeout);
    const clearIntervalSpy = vi.spyOn(global, "clearInterval").mockImplementation(() => undefined);

    const handle = init({ apiKey: "plse_test_x", monitor: "svc", fetchImpl });

    expect(unref).toHaveBeenCalledTimes(1);

    handle.stop();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it("aplica backoff exponencial em falha de rede e não derruba a aplicação", async () => {
    const onError = vi.fn();
    fetchImpl.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    fetchImpl.mockResolvedValue(fakeResponse(true, {}));

    const handle = init({ apiKey: "plse_test_x", monitor: "svc", intervalSeconds: 10, fetchImpl, onError });
    await vi.advanceTimersByTimeAsync(0); // sequence 0 falha, entra em backoff

    // durante o backoff (1s), o próximo tick (10s depois) já pode tentar de novo
    await vi.advanceTimersByTimeAsync(10_000);

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    // seq 0 (retentativa) e seq 1 devem ter sido enviados depois que a rede voltou
    const sequences = fetchImpl.mock.calls.map(
      ([, reqInit]: [string, RequestInit]) => JSON.parse(reqInit.body as string).sequence,
    );
    expect(sequences).toContain(0);
    expect(sequences).toContain(1);

    handle.stop();
  });

  it("limita o tamanho da fila: descarta os batimentos mais antigos primeiro", async () => {
    fetchImpl.mockRejectedValue(new Error("rede indisponível"));
    const handle = init({ apiKey: "plse_test_x", monitor: "svc", intervalSeconds: 1, fetchImpl, onError: () => {} });

    // gera mais heartbeats do que o teto de fila enquanto a rede está fora
    for (let i = 0; i < 25; i++) {
      await vi.advanceTimersByTimeAsync(1_000);
    }

    fetchImpl.mockClear();
    fetchImpl.mockResolvedValue(fakeResponse(true, {}));
    await vi.advanceTimersByTimeAsync(1_000);

    const firstSequenceSent = JSON.parse((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string).sequence;
    expect(firstSequenceSent).toBeGreaterThan(0);

    handle.stop();
  });

  it("registra handlers de SIGTERM/SIGINT e os remove em stop()", () => {
    const before = process.listenerCount("SIGTERM");
    const handle = init({ apiKey: "plse_test_x", monitor: "svc", fetchImpl });
    expect(process.listenerCount("SIGTERM")).toBe(before + 1);

    handle.stop();
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });

  it("no shutdown, envia o beacon de saída intencional e para o timer", async () => {
    const handle = init({ apiKey: "plse_test_x", monitor: "svc", fetchImpl });
    await vi.advanceTimersByTimeAsync(0);
    fetchImpl.mockClear();

    handle.stop();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ingest.pulse.dev/api/v1/heartbeat/offline");
    const payload = JSON.parse(requestInit.body as string);
    expect(payload.monitor).toBe("svc");

    // stop() é idempotente e o timer não deve mais disparar
    fetchImpl.mockClear();
    handle.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("nunca lança para fora do tick, mesmo com erro inesperado no fetch", async () => {
    fetchImpl.mockImplementation(() => {
      throw new Error("erro síncrono inesperado");
    });
    const onError = vi.fn();
    const handle = init({ apiKey: "plse_test_x", monitor: "svc", fetchImpl, onError });

    await expect(vi.advanceTimersByTimeAsync(0)).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalled();

    handle.stop();
  });
});
