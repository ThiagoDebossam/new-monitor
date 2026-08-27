# ADR-0001 — Monorepo TypeScript com pnpm workspaces

**Status:** aceito · **Data:** 2026-08-27

## Contexto

O projeto tem quatro artefatos que compartilham vocabulário: um SDK publicado no npm, uma API
de ingestão, um processo detector e um painel web. O contrato de heartbeat aparece nos quatro.

## Decisão

Monorepo único com pnpm workspaces:

```
apps/web        Next.js — painel + rota de ingestão
apps/detector   processo de varredura
packages/sdk    @pulse/node — publicado no npm
packages/db     schema, migrations, cliente
packages/emails templates transacionais
```

O tipo do payload de heartbeat vive em `packages/sdk` e é importado pela API. Uma mudança que
quebre o contrato quebra o typecheck no mesmo commit.

## Consequências

- Um `pnpm install`, um CI, um lugar para ADRs — barato para uma equipe pequena
- Refatoração atravessa pacotes sem coordenação de versões
- O SDK precisa ser publicável sem arrastar o workspace: zero dependências de runtime e build
  próprio (`tsup`)
- Se a ingestão exigir escala independente do painel um dia, ela sai de `apps/web` para
  `apps/ingest` sem mudar o modelo de dados
