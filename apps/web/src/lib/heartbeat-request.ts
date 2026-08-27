export class BadRequestError extends Error {}

export function extractApiKey(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const key = match?.[1]?.trim();
  return key && key.length > 0 ? key : null;
}

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new BadRequestError(`"${field}" é obrigatório`);
  }
  return value;
}

function asRecord(json: unknown): Record<string, unknown> {
  if (typeof json !== "object" || json === null) throw new BadRequestError("corpo inválido");
  return json as Record<string, unknown>;
}

export interface HeartbeatBody {
  monitor: string;
  instance: string;
  sequence: number;
  hostname?: string;
  pid?: number;
  version?: string;
  env?: string;
  startedAt?: string;
}

// O contrato (DISCOVERY.md §6.5) também aceita "interval", mas o servidor é quem manda no
// intervalo efetivo — o campo do cliente é só informativo e não precisa ser validado aqui.
export function parseHeartbeatBody(json: unknown): HeartbeatBody {
  const body = asRecord(json);
  const monitor = requireString(body, "monitor");
  const instance = requireString(body, "instance");
  const sequence = body.sequence;
  if (typeof sequence !== "number" || !Number.isFinite(sequence)) {
    throw new BadRequestError('"sequence" é obrigatório e deve ser numérico');
  }
  return {
    monitor,
    instance,
    sequence,
    hostname: typeof body.hostname === "string" ? body.hostname : undefined,
    pid: typeof body.pid === "number" ? body.pid : undefined,
    version: typeof body.version === "string" ? body.version : undefined,
    env: typeof body.env === "string" ? body.env : undefined,
    startedAt: typeof body.startedAt === "string" ? body.startedAt : undefined,
  };
}

export interface OfflineBody {
  monitor: string;
  instance: string;
}

export function parseOfflineBody(json: unknown): OfflineBody {
  const body = asRecord(json);
  return { monitor: requireString(body, "monitor"), instance: requireString(body, "instance") };
}
