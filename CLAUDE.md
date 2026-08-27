# Pulse — contexto para sessões de IA

Monitoramento de aplicações Node por heartbeat. Um SDK anuncia vida periodicamente; um detector
percebe o silêncio; um e-mail avisa. SaaS multi-tenant.

## Leia antes de codar

| Antes de | Leia |
|---|---|
| Qualquer coisa | [`docs/DISCOVERY.md`](docs/DISCOVERY.md) |
| Começar uma fase | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| Mudar arquitetura | [`docs/adr/`](docs/adr/) — e escreva um ADR novo |

**Estado atual: discovery concluído, Fase 0 não iniciada.** Não há código de produto no
repositório. Os comandos abaixo descrevem o alvo, não o presente.

## Estrutura alvo

```
apps/web         Next.js — painel + POST /api/v1/heartbeat
apps/detector    varredura de instâncias expiradas
apps/notifier    consumo da fila de e-mails
packages/sdk     @pulse/node — publicado no npm
packages/db      schema Drizzle, migrations, cliente
packages/emails  templates React Email
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
