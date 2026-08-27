// RF-1 a RF-3, RNF-6. O SDK roda dentro da aplicação do cliente: nenhuma operação aqui pode
// lançar uma exceção não tratada, bloquear, ou impedir o processo de encerrar (CLAUDE.md,
// invariante #1).
import { randomUUID } from "node:crypto";
import { hostname as osHostname } from "node:os";

export const SDK_NAME = "@pulse/node";
export const SDK_VERSION = "0.0.0";

const DEFAULT_BASE_URL = "https://ingest.pulse.dev";
const DEFAULT_INTERVAL_SECONDS = 30;
// RF-2: "reenvia com backoff exponencial... com teto de fila". Nenhum destes números vem do
// discovery — são um ponto de partida documentado, ajustável sem mudar o contrato.
const MAX_QUEUE_SIZE = 20;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;
const OFFLINE_TIMEOUT_MS = 2_000;

export interface InitOptions {
  apiKey: string;
  monitor: string;
  baseUrl?: string;
  intervalSeconds?: number;
  environment?: string;
  appVersion?: string;
  hostname?: string;
  /** Injeção de dependência para testes — por padrão usa o `fetch` global do Node. */
  fetchImpl?: typeof fetch;
  /** Nunca lançado pelo SDK — um erro dentro deste callback é engolido (RNF-6). */
  onError?: (error: unknown) => void;
}

export interface PulseHandle {
  /** Para o timer e envia o beacon de saída intencional — mesma ação do handler de SIGTERM. */
  stop(): void;
}

interface HeartbeatPayload {
  monitor: string;
  instance: string;
  env?: string;
  version?: string;
  hostname?: string;
  pid: number;
  startedAt: string;
  sequence: number;
  interval: number;
}

interface HeartbeatResponseBody {
  intervalSeconds?: number;
}

export function init(options: InitOptions): PulseHandle {
  if (!options.apiKey) throw new Error("@pulse/node: apiKey é obrigatório");
  if (!options.monitor) throw new Error("@pulse/node: monitor é obrigatório");

  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  const instanceKey = randomUUID();
  // Exibido, nunca comparado (Risco R-2) — o servidor nunca usa este valor para decidir estado.
  const startedAt = new Date().toISOString();
  let sequence = 0;
  let intervalSeconds = options.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS;
  let backoffMs = BASE_BACKOFF_MS;
  let backoffUntil = 0;
  let stopped = false;
  const queue: HeartbeatPayload[] = [];

  const reportError = (error: unknown) => {
    try {
      options.onError?.(error);
    } catch {
      // Um handler de erro do usuário jamais pode, por sua vez, derrubar a aplicação.
    }
  };

  let timer: NodeJS.Timeout;

  const rescheduleTimer = (newIntervalSeconds: number) => {
    if (newIntervalSeconds === intervalSeconds || newIntervalSeconds <= 0) return;
    intervalSeconds = newIntervalSeconds;
    clearInterval(timer);
    timer = setInterval(runTick, intervalSeconds * 1000);
    timer.unref();
  };

  const sendHeartbeat = async (payload: HeartbeatPayload): Promise<boolean> => {
    try {
      const response = await fetchImpl(`${baseUrl}/api/v1/heartbeat`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) return false;
      // O servidor devolve intervalSeconds; o SDK obedece (DISCOVERY.md §6.5).
      const body = (await response.json().catch(() => null)) as HeartbeatResponseBody | null;
      if (body?.intervalSeconds) rescheduleTimer(body.intervalSeconds);
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  };

  const flushQueue = async () => {
    if (Date.now() < backoffUntil) return;
    while (queue.length > 0) {
      const payload = queue[0];
      if (!payload) break;
      const ok = await sendHeartbeat(payload);
      if (!ok) {
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        backoffUntil = Date.now() + backoffMs;
        return;
      }
      backoffMs = BASE_BACKOFF_MS;
      queue.shift();
    }
  };

  const tick = async () => {
    const payload: HeartbeatPayload = {
      monitor: options.monitor,
      instance: instanceKey,
      env: options.environment,
      version: options.appVersion,
      hostname: options.hostname ?? safeHostname(),
      pid: process.pid,
      startedAt,
      sequence: sequence++,
      interval: intervalSeconds,
    };
    queue.push(payload);
    // Teto de fila: durante uma partição de rede prolongada, mantém só os batimentos mais
    // recentes — o furo de `sequence` no servidor já denuncia os que foram descartados.
    while (queue.length > MAX_QUEUE_SIZE) queue.shift();
    await flushQueue();
  };

  const runTick = () => {
    void tick().catch(reportError);
  };

  runTick();
  timer = setInterval(runTick, intervalSeconds * 1000);
  timer.unref(); // Invariante #1: nunca segurar o event loop do cliente.

  const handleShutdown = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    process.off("SIGTERM", handleShutdown);
    process.off("SIGINT", handleShutdown);
    // Melhor esforço, com timeout curto: nunca atrasa o encerramento do processo hospedeiro.
    // try/catch síncrono também: um fetchImpl (injetado em teste ou não) que lance na hora,
    // em vez de rejeitar a promise, não pode escapar de um listener de SIGTERM/SIGINT.
    try {
      fetchImpl(`${baseUrl}/api/v1/heartbeat/offline`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify({ monitor: options.monitor, instance: instanceKey }),
        signal: AbortSignal.timeout(OFFLINE_TIMEOUT_MS),
      }).catch(reportError);
    } catch (error) {
      reportError(error);
    }
  };

  process.on("SIGTERM", handleShutdown);
  process.on("SIGINT", handleShutdown);

  return { stop: handleShutdown };
}

function safeHostname(): string | undefined {
  try {
    return osHostname();
  } catch {
    return undefined;
  }
}

export const pulse = { init };
