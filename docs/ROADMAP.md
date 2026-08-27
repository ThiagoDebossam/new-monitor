# Roadmap — Pulse

Sete fases até o MVP publicável. Cada uma entrega algo verificável e nenhuma depende de uma
fase posterior para provar que funciona.

**Princípio de ordenação:** de dentro para fora. O núcleo (heartbeat → detecção → alerta) é
construído e testado antes de existir qualquer tela. Uma interface bonita sobre uma detecção
errada é pior que nenhuma interface.

---

## Fase 0 — Fundação e harness

**Objetivo:** o repositório está pronto para que humano e IA trabalhem nele sem improviso.

- Monorepo pnpm: `apps/web`, `apps/detector`, `packages/sdk`, `packages/db`, `packages/emails`
- TypeScript estrito compartilhado, ESLint, Prettier
- Vitest configurado com Postgres efêmero via Testcontainers
- `docker-compose.yml` para desenvolvimento (Postgres + Mailpit)
- CI no GitHub Actions: typecheck, lint, teste, build
- `CLAUDE.md` e ADRs versionados; hook de `SessionStart` que prepara o ambiente

**Pronto quando:** `pnpm install && pnpm test` passa em um clone limpo e no CI.

---

## Fase 1 — Núcleo do heartbeat

**Objetivo:** um processo Node bate o coração, o servidor registra, o detector percebe o silêncio.
Sem nenhuma tela.

- Schema e migrations: organizations, projects, api_keys, monitors, instances, incidents
- `POST /api/v1/heartbeat` — autenticação por chave, autoprovisionamento, upsert de instância
- `POST /api/v1/heartbeat/offline` — saída intencional
- Detector: varredura, transição de estado, abertura e resolução de incidente
- SDK `@pulse/node`: `init()`, timer `unref()`ado, fila com backoff, handlers de sinal
- Testes de integração cobrindo os cenários que decidem o produto:
  - instância expira → monitor cai → incidente abre
  - instância volta → incidente resolve com duração correta
  - **deploy rolling com `min = 1` → nenhum incidente**
  - `SIGTERM` com réplica remanescente → nenhum incidente
  - 2 de 3 réplicas morrem com `min = 3` → incidente abre
  - dois detectores concorrentes → um único incidente (garantia do índice único parcial)

**Pronto quando:** um script sobe três processos, mata dois, e o banco mostra exatamente um
incidente aberto — sem ninguém olhar uma tela.

---

## Fase 2 — Alertas por e-mail

**Objetivo:** o silêncio vira um e-mail na caixa de entrada.

- Interface `EmailProvider` com implementações Resend e log-local
- Templates de queda e de recuperação (React Email): o que caiu, desde quando, quantas
  instâncias, link direto para o monitor
- Regras anti-flapping: cooldown por monitor; recuperação só notifica se houve notificação de queda
- Registro de entrega em `notifications`, com `provider_message_id` e erro
- Reenvio com backoff em falha do provedor
- SPF, DKIM e DMARC configurados e verificados

**Pronto quando:** matar um processo local resulta em e-mail no Mailpit em menos de 30 s, e
derrubar/subir dez vezes em cinco minutos resulta em no máximo dois e-mails.

---

## Fase 3 — Painel web

**Objetivo:** a informação que já existe fica visível.

- Auth.js com e-mail e senha; criação de organização no primeiro acesso
- Convite de membros por e-mail; papéis owner/admin/member
- Projetos e gestão de chaves (criar, nomear, revogar; texto claro exibido uma vez)
- Lista de monitores: estado, último batimento, uptime da janela — vermelho primeiro
- Detalhe do monitor: instâncias vivas, histórico de incidentes, linha do tempo, configuração
  de intervalo, tolerância e mínimo de instâncias
- Pausar monitor (janela de manutenção)
- Testes de isolamento entre tenants em toda rota de leitura

**Pronto quando:** um usuário novo cria conta, copia a chave, roda o exemplo e vê o monitor
verde — sem instrução além do README.

---

## Fase 4 — Endurecimento

**Objetivo:** sobreviver ao uso real e a si mesmo.

- Rate limit por chave de API, com resposta `429` que o SDK respeita
- Teto de monitores por projeto, com aviso ao aproximar (Risco R-6)
- Retenção: instâncias encerradas há mais de 24 h são removidas
- **Dead man's switch externo**: o detector bate em um serviço de terceiros a cada ciclo —
  se o Pulse morrer, alguém avisa (Risco R-4)
- Logs estruturados, métricas de latência de ingestão, `/healthz`
- Teste de carga confirmando RNF-1 e RNF-5

**Pronto quando:** o teste de carga sustenta 200 req/s com p95 abaixo de 100 ms, e desligar
o detector gera alerta externo.

---

## Fase 5 — Publicação do SDK

**Objetivo:** a promessa dos cinco minutos é verdadeira para quem chega de fora.

- Nome definitivo, licença e publicação no npm
- README do SDK com exemplos: Express, worker de fila, processo puro
- Tipos exportados, ESM + CJS, zero dependências de runtime
- Suporte a `PULSE_API_KEY` e `PULSE_MONITOR` por variável de ambiente
- Página de onboarding no painel com o trecho pronto para copiar

**Pronto quando:** alguém de fora do projeto instala e vê o monitor verde em menos de cinco
minutos, cronometrado.

---

## Fase 6 — Beta fechado

**Objetivo:** descobrir o que o discovery não previu.

- 5 a 10 equipes reais em produção
- Instrumentar as métricas do § 9 do discovery, especialmente alertas falsos
- Canal de feedback e triagem semanal

**Pronto quando:** trinta dias com menos de 0,1 alerta falso por monitor.

---

## Pós-MVP

Em ordem provável de valor, a ser revista com os dados do beta:

1. **Monitoramento de cron/jobs** — `pulse.job("nightly-billing")` com start/sucesso/falha e
   duração. Detecta o job que não rodou, que nenhum heartbeat detecta.
2. **Canais adicionais** — Slack, Discord, webhook.
3. **Escalonamento** — quem é avisado se ninguém reconhecer em N minutos.
4. **Status page pública**.
5. **Billing e planos**.
6. **SDKs em outras linguagens** — o protocolo já é trivial de portar por design.

---

## Definição de Pronto (todas as fases)

- [ ] Testes automatizados cobrindo o caminho feliz e os modos de falha da fase
- [ ] Toda mudança de schema por migration versionada, nunca por edição manual
- [ ] Toda rota que lê dados tem teste de isolamento entre tenants
- [ ] ADR criado ou atualizado se uma decisão arquitetural mudou
- [ ] `pnpm typecheck && pnpm lint && pnpm test` verde no CI
- [ ] Nenhum segredo no código ou no histórico
