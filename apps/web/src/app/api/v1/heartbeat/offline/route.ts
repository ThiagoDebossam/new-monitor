import { resolveProjectByApiKey } from "@pulse/db/api-keys";
import { InvalidSlugError, recordOffline } from "@pulse/db/heartbeat";
import { getDb } from "@/lib/db";
import { BadRequestError, extractApiKey, parseOfflineBody } from "@/lib/heartbeat-request";

// RF-3: saída intencional (SIGTERM/SIGINT) — nunca abre incidente (ver recordOffline).
// Mesma disciplina de no máximo duas queries da rota de heartbeat (invariante #8).
export async function POST(request: Request): Promise<Response> {
  const apiKey = extractApiKey(request);
  if (!apiKey) {
    return Response.json({ error: "chave de API ausente ou mal formada" }, { status: 401 });
  }

  let body;
  try {
    body = parseOfflineBody(await request.json());
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
    await recordOffline(db, { projectId, monitorSlug: body.monitor, instanceKey: body.instance });
    return Response.json({ serverTime: new Date().toISOString() }, { status: 202 });
  } catch (error) {
    if (error instanceof InvalidSlugError) return Response.json({ error: error.message }, { status: 400 });
    console.error("[heartbeat/offline] falha ao registrar", error);
    return Response.json({ error: "erro interno" }, { status: 500 });
  }
}
