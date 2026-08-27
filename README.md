# Pulse — monitoramento de aplicações Node por heartbeat

> Nome de trabalho. A definição do nome/marca é uma decisão em aberto (ver `docs/DISCOVERY.md` § 11).

Um SDK Node que sua aplicação instala em uma linha, um painel web que mostra se ela está viva,
e um e-mail quando ela para de bater o coração.

```ts
import { pulse } from "@pulse/node";

pulse.init({ apiKey: process.env.PULSE_API_KEY, monitor: "api-pagamentos" });
```

## Estado atual

**Fase de discovery concluída. Nenhum código de produto escrito ainda.**

| Documento | O que contém |
|---|---|
| [`docs/DISCOVERY.md`](docs/DISCOVERY.md) | Problema, personas, escopo, requisitos, domínio, modelo de dados, arquitetura, riscos |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Fases de desenvolvimento, entregáveis e critérios de pronto |
| [`docs/adr/`](docs/adr/) | Decisões arquiteturais registradas (ADRs) |
| [`CLAUDE.md`](CLAUDE.md) | Harness: contexto, convenções e regras de trabalho para sessões de IA |

## Decisões fechadas

- **Produto:** SaaS multi-tenant (organizações → projetos → monitores)
- **Stack:** monorepo TypeScript, pnpm workspaces, Next.js (App Router) + Postgres
- **SDK v1:** heartbeat + metadados de processo
- **Deploy:** Docker (VPS / Railway / Fly)
