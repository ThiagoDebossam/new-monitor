// Processo separado do servidor web (ADR-0009, invariante #6 do CLAUDE.md): N réplicas do
// painel nunca multiplicam a varredura, porque a varredura não roda dentro delas.
import { createDb } from "@pulse/db/client";
import { sweep } from "@pulse/db/detector";

// ADR-0004: uma varredura a cada 10s atende RNF-2 (≤15s de atraso) com folga.
export const SCAN_INTERVAL_MS = 10_000;

export async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL não definido");
  const db = createDb(databaseUrl);

  console.log("[detector] iniciado — varredura a cada 10s (ADR-0004)");

  const tick = async () => {
    try {
      const opened = await sweep(db);
      if (opened.length > 0) {
        console.log(`[detector] ${opened.length} incidente(s) aberto(s): ${opened.map((o) => o.monitorId).join(", ")}`);
      }
    } catch (error) {
      console.error("[detector] falha na varredura", error);
    }
  };

  await tick();
  setInterval(() => void tick(), SCAN_INTERVAL_MS);
}

// Só roda ao ser executado diretamente (tsx src/index.ts) — importar este módulo em testes não
// deve abrir conexão nenhuma nem começar a varredura.
const isEntrypoint = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error("[detector] erro fatal", error);
    process.exit(1);
  });
}
