# Pulse — monitoramento de aplicações Node por heartbeat

> Nome de trabalho. A definição do nome/marca é uma decisão em aberto (ver `docs/DISCOVERY.md` § 11).

Um SDK Node que sua aplicação instala em uma linha, um painel web que mostra se ela está viva,
e um e-mail quando ela para de bater o coração.

```ts
import { pulse } from "@pulse/node";

pulse.init({ apiKey: process.env.PULSE_API_KEY, monitor: "api-pagamentos" });
```

## Estado atual

**Fases 0 e 1 escritas, ainda não instaladas nem validadas.** Discovery concluído; o núcleo do
heartbeat (schema, rotas de ingestão, detector, SDK) está implementado, mas esta sessão também
não teve acesso ao registro do npm nem a um daemon Docker para instalar dependências e rodar os
testes de integração (Testcontainers). Antes de seguir para a Fase 2, alguém com rede normal
precisa rodar `pnpm install`, gerar a migration inicial (`pnpm --filter @pulse/db run generate`)
e então `pnpm test` — ver `CLAUDE.md` para o estado exato.

| Documento | O que contém |
|---|---|
| [`docs/DISCOVERY.md`](docs/DISCOVERY.md) | Problema, personas, escopo, requisitos, domínio, modelo de dados, arquitetura, riscos |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Fases de desenvolvimento, entregáveis e critérios de pronto |
| [`docs/adr/`](docs/adr/) | Decisões arquiteturais registradas (ADRs) |
| [`CLAUDE.md`](CLAUDE.md) | Harness: contexto, convenções e regras de trabalho para sessões de IA |

## Começando

```bash
cp .env.example .env
pnpm install
docker compose up -d   # Postgres + Mailpit
pnpm test              # inclui teste de integração via Testcontainers
pnpm dev                # web (localhost:3000) + detector
```

Requer Node 22+, pnpm 10+ e Docker. Ainda não há `pnpm-lock.yaml` commitado — a primeira
`pnpm install` com acesso normal à rede deve gerá-lo, e o resultado deve ser commitado.

## Decisões fechadas

- **Produto:** SaaS multi-tenant (organizações → projetos → monitores)
- **Stack:** monorepo TypeScript, pnpm workspaces, Next.js (App Router) + Postgres
- **SDK v1:** heartbeat + metadados de processo
- **Deploy:** Docker (VPS / Railway / Fly)
