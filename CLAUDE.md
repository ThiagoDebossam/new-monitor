# Pulse — contexto para sessões de IA

Monitoramento de aplicações Node por heartbeat. Um SDK anuncia vida periodicamente; um detector
percebe o silêncio; um e-mail avisa. SaaS multi-tenant.

## Leia antes de codar

| Antes de | Leia |
|---|---|
| Qualquer coisa | [`docs/DISCOVERY.md`](docs/DISCOVERY.md) |
| Começar uma fase | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| Mudar arquitetura | [`docs/adr/`](docs/adr/) — e escreva um ADR novo |

**Estado atual: Fase 0 (fundação) escrita, ainda não instalada nem validada em CI.**
`pnpm install` não roda nesta sessão — o sandbox bloqueia `registry.npmjs.org` e não tem daemon
Docker. Nenhum arquivo foi verificado além de parsing estático (JSON/YAML válidos, sintaxe TS
correta). A primeira coisa a fazer com acesso normal à rede é rodar `pnpm install` e, se algo
não resolver, corrigir antes de seguir para a Fase 1.

## Estrutura atual

```
apps/web         Next.js — placeholder; POST /api/v1/heartbeat chega na Fase 1
apps/detector    scaffold; varredura real chega na Fase 1
packages/sdk     @pulse/node — build ESM+CJS via tsup; init()/heartbeat chegam na Fase 1
packages/db      cliente Drizzle + teste de integração via Testcontainers; schema vem na Fase 1
packages/emails  scaffold; templates chegam na Fase 2
apps/notifier    ainda não existe — criado quando a Fase 2 precisar dele (ver ADR-0009)
```

## Comandos

```bash
pnpm dev          # web + detector + docker compose (postgres, mailpit)
pnpm test         # Vitest; integração usa Postgres efêmero
pnpm typecheck
pnpm lint
pnpm db:generate  # gera migration a partir do schema
pnpm db:migrate
```

## Invariantes

Estas regras vêm de decisões registradas. Violá-las quebra o produto de formas que os testes
podem não pegar.

1. **O SDK nunca pode derrubar a aplicação do cliente.** Toda operação em `try/catch`, timer
   `unref()`ado, nenhuma falha de rede propagada. (RNF-6)
2. **Nenhum timestamp do cliente decide estado.** `startedAt` é exibido, nunca comparado.
   Relógio de container não é confiável. (Risco R-2)
3. **Heartbeats não viram linhas.** Atualizam estado. Uptime deriva de incidentes.
   ([ADR-0005](docs/adr/0005-sem-persistir-heartbeats.md))
4. **Incidentes pertencem ao monitor, nunca à instância.**
   ([ADR-0003](docs/adr/0003-monitor-instance.md))
5. **`org_id` vem sempre da sessão; `project_id` sempre do hash da chave.** Nunca de
   parâmetro de URL ou corpo de requisição. (RF-12)
6. **Detector e notifier são processos separados.** Nunca um `setInterval` dentro do servidor
   web — N réplicas multiplicariam a varredura por N.
   ([ADR-0009](docs/adr/0009-deploy-docker.md))
7. **Schema muda por migration versionada.** Nunca por edição manual do banco.
8. **A rota de ingestão não toca em sessão e faz no máximo duas queries.** O painel fora do ar
   não pode custar um heartbeat. (RNF-8)

## Convenções

- TypeScript estrito. `any` só com comentário justificando.
- SQL explícito via Drizzle. Índices parciais são parte do design, não otimização tardia.
- Erros de domínio são tipos, não strings soltas.
- Mensagens de commit no imperativo, em português, referenciando a fase: `fase-1: adiciona
  varredura do detector`.
- Comentários explicam *por quê*, não *o quê*. O que já está no código.

## Definição de Pronto

Toda entrega, sem exceção:

- [ ] Testes cobrindo caminho feliz **e** modos de falha
- [ ] Teste de isolamento entre tenants em toda rota que lê dados
- [ ] Migration versionada para toda mudança de schema
- [ ] ADR criado ou atualizado se uma decisão arquitetural mudou
- [ ] `pnpm typecheck && pnpm lint && pnpm test` verde
- [ ] Nenhum segredo no código ou no histórico

## Cenários que decidem o produto

Ao mexer em detecção ou estado, estes testes precisam continuar passando. Eles não são
casos de borda — são o produto:

- Deploy rolling com `min = 1` → **nenhum** incidente
- `SIGTERM` com réplica remanescente → **nenhum** incidente
- 2 de 3 réplicas morrem com `min = 3` → incidente abre
- Instância expira e volta → incidente resolve com duração correta
- Dois detectores concorrentes → **um único** incidente
- Dez quedas em cinco minutos → no máximo dois e-mails

O primeiro é o mais importante. Um monitor que alarma em deploy é desinstalado em duas semanas.

## Armadilhas conhecidas

- `setInterval` sem `unref()` impede o processo do cliente de encerrar
- Calcular uptime contando heartbeats — não existem heartbeats armazenados
- Criar incidente sem apoiar-se no índice único parcial — dois detectores abrem dois
- Usar `Date.now()` do cliente em qualquer comparação
- Esquecer o teto de monitores ao mexer em autoprovisionamento (Risco R-6)
