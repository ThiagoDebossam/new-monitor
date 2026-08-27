// ADR-0004: detecção por varredura periódica, não por jobs agendados.
import { sql } from "drizzle-orm";
import type { Database } from "./client.js";

// Custo proporcional às instâncias expiradas, não ao total (índice parcial em
// instances(expected_next_at) WHERE status='up'). 1000 é o teto por ciclo do ADR-0004.
const SWEEP_BATCH_SIZE = 1000;

export interface OpenedIncident {
  id: string;
  monitorId: string;
}

/**
 * Um ciclo de varredura: expira instâncias silenciosas, recalcula quantas instâncias vivas cada
 * monitor afetado ainda tem e abre um incidente para quem cruzou `min_healthy_instances`.
 *
 * A abertura de incidente se apoia no índice único parcial `incidents(monitor_id) WHERE
 * resolved_at IS NULL` via `ON CONFLICT ... DO NOTHING`: mesmo que dois detectores rodem esta
 * função ao mesmo tempo sobre o mesmo monitor, no máximo um incidente é criado — a garantia
 * fica no schema, não nesta função (DISCOVERY.md §7).
 *
 * A resolução de incidentes não é responsabilidade deste ciclo: ela acontece no primeiro
 * heartbeat que volta a confirmar o monitor (ver `recordHeartbeat`).
 *
 * `pre_live` lê `instances` no snapshot de *antes* desta varredura (todas as partes de um único
 * WITH compartilham o mesmo snapshot — nenhuma vê a escrita da outra, mesmo referenciando seu
 * RETURNING) e a contagem pós-varredura é obtida subtraindo `expired_count`, em vez de reler a
 * tabela depois do UPDATE, o que devolveria a contagem de antes dele.
 */
export async function sweep(db: Database): Promise<OpenedIncident[]> {
  const rows = await db.execute(sql`
    WITH expired AS (
      UPDATE instances SET status = 'down'
      WHERE id IN (
        SELECT id FROM instances
        WHERE status = 'up' AND expected_next_at < now()
        ORDER BY expected_next_at
        LIMIT ${SWEEP_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING monitor_id
    ),
    expired_counts AS (
      SELECT monitor_id, count(*)::int AS expired_count FROM expired GROUP BY monitor_id
    ),
    pre_live AS (
      SELECT ec.monitor_id, count(i.id) FILTER (WHERE i.status = 'up')::int AS live
      FROM expired_counts ec
      LEFT JOIN instances i ON i.monitor_id = ec.monitor_id
      GROUP BY ec.monitor_id
    ),
    newly_down AS (
      UPDATE monitors SET status = 'down', status_changed_at = now()
      FROM expired_counts ec, pre_live pl
      WHERE monitors.id = ec.monitor_id
        AND monitors.id = pl.monitor_id
        AND monitors.status = 'up'
        AND (pl.live - ec.expired_count) < monitors.min_healthy_instances
      RETURNING monitors.id AS monitor_id
    )
    INSERT INTO incidents (monitor_id, started_at)
    SELECT monitor_id, now() FROM newly_down
    ON CONFLICT (monitor_id) WHERE resolved_at IS NULL DO NOTHING
    RETURNING id, monitor_id;
  `);

  return (rows as unknown as { id: string; monitor_id: string }[]).map((row) => ({
    id: row.id,
    monitorId: row.monitor_id,
  }));
}
