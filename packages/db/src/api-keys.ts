// ADR-0007: chaves de API com hash, escopo de projeto e prefixo reconhecível.
import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "./client.js";

export type ApiKeyEnvironment = "live" | "test";

export interface GeneratedApiKey {
  /** Texto claro — exibido uma única vez, na criação (RF-10). Nunca é persistido. */
  key: string;
  keyHash: string;
  keyPrefix: string;
}

export function generateApiKey(environment: ApiKeyEnvironment = "live"): GeneratedApiKey {
  // 16 bytes em base64url = 22 caracteres, o comprimento de entropia definido no ADR-0007.
  const random = randomBytes(16).toString("base64url");
  const key = `plse_${environment}_${random}`;
  return { key, keyHash: hashApiKey(key), keyPrefix: key.slice(0, 12) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Resolve o `project_id` de uma chave em texto claro, ou `null` se ela não existir ou tiver
 * sido revogada. Também marca `last_used_at`, no mesmo round-trip — é a query de autenticação
 * da rota de ingestão (invariante #8 do CLAUDE.md: no máximo duas queries no total).
 */
export async function resolveProjectByApiKey(db: Database, rawKey: string): Promise<string | null> {
  const keyHash = hashApiKey(rawKey);
  const rows = await db.execute(sql`
    UPDATE api_keys SET last_used_at = now()
    WHERE key_hash = ${keyHash} AND revoked_at IS NULL
    RETURNING project_id;
  `);
  const row = rows[0] as { project_id: string } | undefined;
  return row?.project_id ?? null;
}
