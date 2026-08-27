// Núcleo da Fase 1: RF-1 a RF-6, ADR-0003, ADR-0005, ADR-0006.
import { sql } from "drizzle-orm";
import type { Database } from "./client.js";

// Nenhum destes valores é definido explicitamente pelo discovery — "grace padrão generoso"
// (Risco R-1) é o único requisito. 30s/30s dá 60s de tolerância antes que uma instância seja
// considerada expirada, mais até 10s de atraso da varredura (ADR-0004) — dentro de RNF-2.
export const DEFAULT_INTERVAL_SECONDS = 30;
export const DEFAULT_GRACE_SECONDS = 30;
export const DEFAULT_MIN_HEALTHY_INSTANCES = 1;

// Slug normalizado: minúsculo, alfanumérico com hífen interno, 1-64 caracteres — mesma forma de
// um label DNS. Rejeita o vazio e o `` `job-${uuid}` `` cru sem normalização (ADR-0006, Risco R-6).
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export class InvalidSlugError extends Error {
  constructor(readonly rawSlug: string) {
    super(`slug de monitor inválido: "${rawSlug}"`);
    this.name = "InvalidSlugError";
  }
}

export function normalizeMonitorSlug(rawSlug: string): string {
  const slug = rawSlug.trim().toLowerCase();
  if (!SLUG_PATTERN.test(slug)) throw new InvalidSlugError(rawSlug);
  return slug;
}

export interface HeartbeatInput {
  /** Sempre derivado do hash da chave de API — nunca de parâmetro de URL ou corpo (RF-12). */
  projectId: string;
  monitorSlug: string;
  instanceKey: string;
  sequence: number;
  hostname?: string | null;
  pid?: number | null;
  sdkVersion?: string | null;
  appVersion?: string | null;
  environment?: string | null;
  /** Exibido, nunca comparado (Risco R-2) — o relógio do cliente não decide estado nenhum. */
  startedAt?: Date | null;
}

export interface HeartbeatResult {
  intervalSeconds: number;
  serverTime: Date;
}

interface HeartbeatRow {
  interval_seconds: number;
  server_time: Date;
}

/**
 * Registra um heartbeat: autoprovisiona o monitor (ADR-0006), faz upsert da instância e, se o
 * monitor estava caído ou ainda não confirmado, promove-o e resolve o incidente em aberto —
 * tudo em um único statement. Junto com `resolveProjectByApiKey`, mantém a rota de ingestão em
 * no máximo duas queries (invariante #8 do CLAUDE.md).
 *
 * Dentro de um único WITH, todas as partes enxergam o mesmo snapshot: uma CTE de leitura não vê
 * o efeito de uma escrita irmã, mesmo referenciando seu RETURNING (é assim que o Postgres
 * documenta CTEs que modificam dados). Por isso `existing_live` conta as instâncias vivas
 * *excluindo* a que está sendo atualizada e soma 1 — em vez de reler `instances` depois do
 * upsert, o que devolveria a contagem de antes da escrita.
 */
export async function recordHeartbeat(db: Database, input: HeartbeatInput): Promise<HeartbeatResult> {
  const slug = normalizeMonitorSlug(input.monitorSlug);

  const rows = await db.execute(sql`
    WITH monitor AS (
      INSERT INTO monitors (project_id, slug, name, interval_seconds, grace_seconds, min_healthy_instances, status, status_changed_at)
      VALUES (
        ${input.projectId}, ${slug}, ${slug},
        ${DEFAULT_INTERVAL_SECONDS}, ${DEFAULT_GRACE_SECONDS}, ${DEFAULT_MIN_HEALTHY_INSTANCES},
        'pending', now()
      )
      ON CONFLICT (project_id, slug) DO UPDATE SET project_id = monitors.project_id
      RETURNING id, status AS status_before, interval_seconds, grace_seconds, min_healthy_instances
    ),
    existing_live AS (
      -- count(i.id), não count(i.*): numa LEFT JOIN sem correspondência, i.* é uma linha
      -- composta não-nula (todos os campos NULL) e contaria 1 a mais; i.id sozinho é NULL de
      -- verdade e count() o ignora corretamente.
      SELECT monitor.id AS monitor_id, count(i.id)::int AS live
      FROM monitor
      LEFT JOIN instances i
        ON i.monitor_id = monitor.id AND i.status = 'up' AND i.instance_key <> ${input.instanceKey}
      GROUP BY monitor.id
    ),
    upserted_instance AS (
      INSERT INTO instances (
        monitor_id, instance_key, status, hostname, pid, sdk_version, app_version, environment,
        started_at, first_seen_at, last_seen_at, expected_next_at, last_sequence
      )
      SELECT
        monitor.id, ${input.instanceKey}, 'up',
        ${input.hostname ?? null}, ${input.pid ?? null}, ${input.sdkVersion ?? null},
        ${input.appVersion ?? null}, ${input.environment ?? null}, ${input.startedAt ?? null},
        now(), now(),
        now() + (monitor.interval_seconds + monitor.grace_seconds) * interval '1 second',
        ${input.sequence}
      FROM monitor
      ON CONFLICT (monitor_id, instance_key) DO UPDATE SET
        status = 'up',
        hostname = EXCLUDED.hostname,
        pid = EXCLUDED.pid,
        sdk_version = EXCLUDED.sdk_version,
        app_version = EXCLUDED.app_version,
        environment = EXCLUDED.environment,
        started_at = EXCLUDED.started_at,
        last_seen_at = now(),
        expected_next_at = EXCLUDED.expected_next_at,
        last_sequence = EXCLUDED.last_sequence
      RETURNING monitor_id
    ),
    promoted AS (
      UPDATE monitors SET status = 'up', status_changed_at = now()
      FROM monitor, existing_live
      WHERE monitors.id = monitor.id
        AND monitor.status_before IN ('pending', 'down')
        AND (existing_live.live + 1) >= monitor.min_healthy_instances
      RETURNING monitors.id AS monitor_id, monitor.status_before AS previous_status
    ),
    resolved_incident AS (
      UPDATE incidents SET resolved_at = now()
      FROM promoted
      WHERE incidents.monitor_id = promoted.monitor_id
        AND incidents.resolved_at IS NULL
        AND promoted.previous_status = 'down'
      RETURNING incidents.id
    )
    SELECT monitor.interval_seconds, now() AS server_time FROM monitor;
  `);

  const row = rows[0] as HeartbeatRow | undefined;
  if (!row) throw new Error("falha ao registrar heartbeat: monitor não resolvido");
  return { intervalSeconds: row.interval_seconds, serverTime: new Date(row.server_time) };
}

export interface OfflineInput {
  projectId: string;
  monitorSlug: string;
  instanceKey: string;
}

/**
 * Saída intencional (RF-3, SIGTERM/SIGINT): marca a instância como encerrada. Nunca abre nem
 * mexe em incidentes — essa é a diferença central com a expiração por silêncio, que é decidida
 * pelo detector (ver DISCOVERY.md §6.2).
 */
export async function recordOffline(db: Database, input: OfflineInput): Promise<void> {
  const slug = normalizeMonitorSlug(input.monitorSlug);
  await db.execute(sql`
    UPDATE instances SET status = 'ended', ended_at = now()
    FROM monitors
    WHERE instances.monitor_id = monitors.id
      AND monitors.project_id = ${input.projectId}
      AND monitors.slug = ${slug}
      AND instances.instance_key = ${input.instanceKey};
  `);
}
