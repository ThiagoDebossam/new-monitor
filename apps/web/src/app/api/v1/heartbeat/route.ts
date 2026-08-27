import { resolveProjectByApiKey } from "@pulse/db/api-keys";
import { InvalidSlugError, recordHeartbeat } from "@pulse/db/heartbeat";
import { getDb } from "@/lib/db";
import { BadRequestError, extractApiKey, parseHeartbeatBody } from "@/lib/heartbeat-request";

// Invariante #8 (CLAUDE.md): esta rota não toca em sessão e faz no máximo duas queries —
// resolveProjectByApiKey (autenticação) e recordHeartbeat (autoprovisiona, upsert, promove).
// RNF-8: a disponibilidade da ingestão é independente do painel.
export async function POST(request: Request): Promise<Response> {
  const apiKey = extractApiKey(request);
  if (!apiKey) {
    return Response.json({ error: "chave de API ausente ou mal formada" }, { status: 401 });
  }

  let body;
  try {
    body = parseHeartbeatBody(await request.json());
  } catch (error) {
    if (error instanceof BadRequestError) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ error: "corpo inválido" }, { status: 400 });
  }

  const db = getDb();
  const projectId = await resolveProjectByApiKey(db, apiKey);
  if (!projectId) {
    return Response.json({ error: "chave de API inválida" }, { status: 401 });
  }

  try {
    const result = await recordHeartbeat(db, {
      projectId,
      monitorSlug: body.monitor,
      instanceKey: body.instance,
      sequence: body.sequence,
      hostname: body.hostname,
      pid: body.pid,
      sdkVersion: body.version,
      environment: body.env,
      startedAt: body.startedAt ? new Date(body.startedAt) : undefined,
    });
    return Response.json(
      { serverTime: result.serverTime.toISOString(), intervalSeconds: result.intervalSeconds },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof InvalidSlugError) return Response.json({ error: error.message }, { status: 400 });
    console.error("[heartbeat] falha ao registrar", error);
    return Response.json({ error: "erro interno" }, { status: 500 });
  }
}
