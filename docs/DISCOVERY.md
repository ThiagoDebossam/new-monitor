# Discovery — Pulse

**Status:** concluído · **Data:** 2026-08-27 · **Fase seguinte:** execução do [ROADMAP](ROADMAP.md)

---

## 1. O problema

Uma aplicação Node pode morrer de formas que ninguém percebe até um cliente reclamar:
o processo trava em um loop, o container é morto por OOM, um worker de fila para de consumir,
o deploy sobe quebrado e o processo sai em silêncio, o cron job simplesmente não roda.

As ferramentas existentes atacam isso de fora para dentro: fazem uma requisição HTTP e veem se
responde. Isso falha em três casos comuns:

1. **Não há porta HTTP.** Workers, consumidores de fila e jobs agendados não escutam em porta nenhuma.
2. **O endpoint responde, mas o processo está doente.** Um `/health` que devolve `200` estático
   continua devolvendo `200` com o event loop travado.
3. **A aplicação está atrás de rede privada.** Não há como alcançá-la de fora sem expor superfície.

O modelo inverso — a própria aplicação anuncia periodicamente que está viva — resolve os três.
Se o batimento para, algo está errado, e isso é verdade independentemente de topologia de rede,
protocolo ou tipo de workload.

### A aposta

> Um `npm install` e três linhas de código devem bastar para que alguém saiba, por e-mail,
> em menos de um minuto, que sua aplicação parou.

O diferencial não é a tecnologia — é o tempo entre instalar e ter valor. Toda decisão de produto
neste documento é subordinada a isso.

---

## 2. Personas

| Persona | Contexto | O que precisa | O que a assusta |
|---|---|---|---|
| **Dev solo / indie** | 3–10 serviços pequenos, sem time de infra | Instalar e esquecer. Zero configuração de servidor. | Complexidade de setup; falso alarme às 3h da manhã |
| **Tech lead de time pequeno** | 10–40 serviços, alguns workers e crons | Ver tudo em uma tela; que o time certo seja avisado | Alerta que ninguém lê; monitor que mente |
| **Dev de plantão** | Recebeu o e-mail agora | Saber *o quê* caiu, *quando*, e se já voltou | E-mail sem contexto acionável |

### Jobs to be done

- *Quando* eu subo um serviço novo, *quero* que ele apareça no painel sem eu cadastrar nada,
  *para* não ter mais um passo manual que eu vou esquecer.
- *Quando* meu worker morre de madrugada, *quero* ser avisado por e-mail em menos de um minuto,
  *para* agir antes do cliente perceber.
- *Quando* eu faço um deploy, *não quero* receber alerta, *para* continuar confiando nos alertas
  que recebo.
- *Quando* eu abro o painel, *quero* ver em cinco segundos o que está vermelho, *para* não ter
  que procurar.

O terceiro job é o mais subestimado e o que mais mata produtos deste tipo: **um monitor que gera
falso positivo em deploy é desligado pelo time em duas semanas.** Boa parte da arquitetura
(§ 6, § 7) existe para atacar isso.

---

## 3. Escopo

### Dentro do MVP

- SDK Node (`@pulse/node`) com heartbeat periódico e desligamento gracioso
- Ingestão autenticada por chave de API com escopo de projeto
- Autoprovisionamento de monitores (o primeiro heartbeat cria o monitor)
- Detecção de ausência de batimento com tolerância configurável
- Incidentes (abertura, resolução, duração)
- Alerta por e-mail em queda e em recuperação, com proteção contra flapping
- Painel web: autenticação, organizações, projetos, lista e detalhe de monitores, gestão de chaves
- Uptime por janela (24h / 7d / 30d)

### Fora do MVP — e por quê

| Fora | Motivo |
|---|---|
| Monitoramento de cron/jobs | Valioso, mas é um segundo modelo de domínio. Fase pós-MVP. |
| Captura de erros / APM | Outro produto. Compete com Sentry. |
| Slack, Discord, webhook, SMS | E-mail cobre o caso de uso central; canais são aditivos e baratos de somar depois. |
| Status page pública | Não resolve o job principal. |
| Billing e planos | Multi-tenant desde já; cobrança depois de existir alguém para cobrar. |
| Métricas de processo (memória, event loop) | Aumenta o payload e o custo de armazenamento sem servir ao job principal. |
| SDKs em outras linguagens | Validar em Node primeiro. O protocolo HTTP é deliberadamente trivial de portar. |

### Não-objetivos permanentes

- Não seremos um APM. Não coletamos traces nem stack traces.
- Não seremos um agregador de logs.
- O SDK **nunca** deve poder derrubar a aplicação que monitora (§ 4, RNF-6).

---

## 4. Requisitos

### Funcionais

| # | Requisito |
|---|---|
| RF-1 | O SDK envia heartbeat em intervalo configurável (padrão 30s) contendo identificação do monitor, da instância e metadados de processo |
| RF-2 | O SDK enfileira em memória e reenvia com backoff exponencial quando a rede falha, com teto de fila |
| RF-3 | O SDK, ao receber `SIGTERM`/`SIGINT`, anuncia saída intencional antes de encerrar |
| RF-4 | O primeiro heartbeat de um slug desconhecido cria o monitor automaticamente, respeitando um teto por projeto |
| RF-5 | O servidor considera um monitor caído quando o número de instâncias vivas fica abaixo do mínimo configurado |
| RF-6 | A queda abre um incidente; o retorno o resolve e registra a duração |
| RF-7 | A abertura de incidente dispara e-mail aos destinatários do projeto; a resolução dispara e-mail de recuperação apenas se houve e-mail de queda |
| RF-8 | O painel lista monitores com estado, último batimento e uptime da janela selecionada |
| RF-9 | O detalhe do monitor mostra instâncias vivas, histórico de incidentes e a linha do tempo de disponibilidade |
| RF-10 | Chaves de API são criadas, nomeadas e revogadas no painel; o valor em texto claro é exibido uma única vez |
| RF-11 | Um monitor pode ser pausado (janela de manutenção) sem perder histórico |
| RF-12 | Dados são isolados por organização; nenhuma consulta atravessa tenants |

### Não-funcionais

| # | Requisito | Alvo |
|---|---|---|
| RNF-1 | Latência de ingestão | p95 < 100 ms, p99 < 300 ms |
| RNF-2 | Atraso de detecção além da tolerância | ≤ 15 s |
| RNF-3 | Atraso de entrega do e-mail após detecção | p95 < 30 s |
| RNF-4 | Falso positivo em deploy rolling | 0 |
| RNF-5 | Carga suportada por instância única | 5.000 instâncias a 30 s ≈ 170 req/s |
| RNF-6 | Impacto do SDK na aplicação | Nunca lança exceção não tratada; nunca bloqueia; nunca impede o processo de encerrar |
| RNF-7 | Custo de armazenamento | Cresce com incidentes, não com heartbeats (§ 6.4) |
| RNF-8 | Disponibilidade da ingestão | Independente do painel: painel fora do ar não perde heartbeat |

RNF-6 merece ênfase. O SDK roda dentro de aplicações de terceiros. Toda operação é `try/catch`,
o timer é `unref()`ado para não segurar o event loop, e nenhuma falha de rede se propaga ao
código do usuário.

---

## 5. Modelo de domínio

```
Organization ──< Membership >── User
     │
     └──< Project ──< ApiKey
              │
              └──< Monitor ──< Instance
                      │
                      └──< Incident ──< Notification
```

### Glossário

| Termo | Definição |
|---|---|
| **Organization** | Tenant. Unidade de isolamento e, no futuro, de cobrança. |
| **Project** | Agrupamento lógico de monitores. Dono das chaves de API. |
| **Monitor** | A coisa que se quer saber se está viva — identificada por um slug estável (`api-pagamentos`). Tem estado, tolerância e política de alerta. |
| **Instance** | Uma execução concreta de um monitor: um processo, em um host, desde um boot. Some quando o processo morre. |
| **Heartbeat** | Anúncio de vida enviado por uma instância. Não é persistido individualmente (§ 6.4). |
| **Incident** | Intervalo contínuo em que o monitor esteve caído. |
| **Grace** | Tolerância somada ao intervalo antes de declarar ausência. |

### A distinção Monitor × Instance

Esta é a decisão de modelagem mais consequente do projeto ([ADR-0003](adr/0003-monitor-instance.md)).

Uma aplicação Node raramente é um processo. É três réplicas no Kubernetes, quatro workers do PM2,
um container que o orquestrador substitui a cada deploy. Se o modelo tivesse apenas "monitor" e o
heartbeat viesse de qualquer processo, dois problemas apareceriam:

- **Deploy geraria alarme.** A instância antiga morre, a nova ainda não bateu, o monitor cai.
- **Morte parcial passaria batido.** Duas de três réplicas morrem, a terceira continua batendo,
  e o painel diz "verde" enquanto dois terços da capacidade sumiu.

Com duas camadas, ambos se resolvem com uma regra só:

> Um monitor está **vivo** enquanto o número de instâncias vivas for `>= min_healthy_instances`.

Com `min = 1` (padrão), o deploy rolling é silencioso: a nova instância bate antes da antiga
expirar. Com `min = 3`, quem roda três réplicas é avisado quando perde uma. O usuário escolhe
a granularidade que lhe interessa mudando um número.

---

## 6. Arquitetura

### 6.1 Componentes

| Componente | Responsabilidade | Escala com |
|---|---|---|
| **`@pulse/node`** | SDK: timer, fila, backoff, sinais de shutdown | — |
| **Ingest** (rota Next.js) | Autenticar, resolver monitor, atualizar estado da instância | Volume de heartbeats |
| **Detector** (processo isolado) | Varrer instâncias expiradas, abrir/fechar incidentes | Número de instâncias |
| **Notifier** | Renderizar e enviar e-mail, deduplicar, registrar entrega | Número de incidentes |
| **Painel** (Next.js) | Auth, leitura, gestão | Número de usuários |
| **Postgres** | Único datastore no MVP | Tudo |

Ingest e painel compartilham o processo Next.js mas são caminhos independentes: a rota de
ingestão não toca em sessão, não renderiza nada e faz no máximo duas queries (RNF-8).

O **detector é um processo separado** ([ADR-0009](adr/0009-deploy-docker.md)) — não uma rota,
não um `setInterval` dentro do servidor web. Isso o mantém funcionando quando o painel está
sobrecarregado e permite escalá-lo, movê-lo ou executá-lo como cron sem tocar no resto.

### 6.2 Fluxo de vida

```
   aplicação do cliente                 Pulse
   ────────────────────                 ─────
   pulse.init()
        │
        ├── POST /api/v1/heartbeat ───► autentica chave
        │    { monitor, instance,        upsert monitor (autoprovisiona)
        │      env, version, hostname,   upsert instance:
        │      pid, startedAt, seq }       last_seen_at = now()
        │                                  expected_next_at = now() + interval + grace
        │   ◄─── 202 { serverTime,       se estava caída → resolve incidente → e-mail de retorno
        │              intervalSeconds }
        │
        │   (a cada intervalo, repete)
        │
   SIGTERM
        └── POST /api/v1/heartbeat/offline ─► marca instância como encerrada
                                              (saída intencional: não abre incidente)

   Detector (a cada 10s, independente)
        └── SELECT instâncias com expected_next_at < now() AND status = 'up'
              → marca 'down'
              → recontar instâncias vivas do monitor
              → se < min_healthy: abre incidente → enfileira e-mail
```

### 6.3 Detecção por varredura

Duas abordagens foram consideradas ([ADR-0004](adr/0004-deteccao-por-varredura.md)):

- **Job agendado por instância** (BullMQ com delay): preciso, mas cada heartbeat cancela e
  reagenda um job — 170 operações de fila por segundo para o mesmo resultado, mais Redis na
  stack, mais um modo de falha (job perdido = falha silenciosa em detectar falha).
- **Varredura periódica**: um `SELECT` a cada 10 s sobre um índice parcial em
  `expected_next_at WHERE status = 'up'`. O custo é proporcional ao número de instâncias
  *expiradas*, não ao total. É idempotente, sobrevive a restart sem estado externo e o pior
  caso de atraso é o próprio período da varredura.

A varredura vence por robustez. `RNF-2` (≤ 15 s de atraso) é atendido com folga por um período
de 10 s. Se algum dia a varredura não couber no orçamento de tempo, ela é particionável por
faixa de hash do monitor sem mudança de modelo.

### 6.4 O que não é armazenado

Heartbeats individuais **não** viram linhas. A 30 s por instância, 5.000 instâncias produzem
14,4 milhões de linhas por dia que ninguém vai ler ([ADR-0005](adr/0005-sem-persistir-heartbeats.md)).

O que se guarda:

- **Estado corrente** — uma linha por instância, atualizada em `UPDATE`. Cardinalidade limitada.
- **Incidentes** — uma linha por queda. Cardinalidade baixíssima.

E uptime se deriva dos incidentes, não dos batimentos:

```
uptime(janela) = 1 − (Σ duração dos incidentes ∩ janela) / duração da janela
```

Isso é exato, barato, e é a razão de RNF-7. O gráfico do painel é desenhado a partir de
intervalos, não de pontos.

### 6.5 Contrato de ingestão

```http
POST /api/v1/heartbeat
Authorization: Bearer plse_live_xxxxxxxxxxxx
Content-Type: application/json

{
  "monitor":   "api-pagamentos",
  "instance":  "01J8ZK3M4N5P6Q7R8S9T",
  "env":       "production",
  "version":   "1.4.2",
  "hostname":  "worker-3",
  "pid":       4711,
  "startedAt": "2026-08-27T10:00:00.000Z",
  "sequence":  142,
  "interval":  30
}
```

```http
202 Accepted
{ "serverTime": "2026-08-27T11:11:00.123Z", "intervalSeconds": 30 }
```

Três decisões embutidas no contrato:

- **O servidor devolve `intervalSeconds`.** O SDK obedece. Assim o intervalo pode ser mudado
  pelo painel sem redeploy da aplicação do cliente.
- **`sequence` é um contador por instância.** Um salto revela batimentos perdidos em trânsito —
  diagnóstico de rede sem custo de armazenamento.
- **Nenhum timestamp do cliente é usado para decidir estado.** `startedAt` é exibido, nunca
  comparado. Relógio de container não é confiável ([Risco R-2](#8-riscos)).

---

## 7. Modelo de dados

```sql
organizations   (id, name, slug, created_at)
users           (id, email, name, password_hash, created_at)
memberships     (id, org_id, user_id, role)                  -- owner | admin | member
projects        (id, org_id, name, slug, created_at)
api_keys        (id, project_id, name, key_hash, key_prefix,
                 last_used_at, revoked_at, created_at)

monitors        (id, project_id, slug, name,
                 interval_seconds, grace_seconds, min_healthy_instances,
                 status, status_changed_at, paused_until, created_at)
                 -- status: pending | up | down | paused
                 -- UNIQUE (project_id, slug)

instances       (id, monitor_id, instance_key, status,
                 hostname, pid, sdk_version, app_version, environment,
                 started_at, first_seen_at, last_seen_at, expected_next_at,
                 last_sequence, ended_at)
                 -- status: up | down | ended
                 -- UNIQUE (monitor_id, instance_key)
                 -- INDEX parcial em (expected_next_at) WHERE status = 'up'

incidents       (id, monitor_id, started_at, resolved_at, cause, notified_at)
                 -- INDEX parcial UNIQUE (monitor_id) WHERE resolved_at IS NULL
notifications   (id, incident_id, kind, channel, target,
                 sent_at, provider_message_id, error)
                 -- kind: down | recovered
notification_targets (id, project_id, email, verified_at)
```

Dois índices carregam o sistema:

- O **índice parcial em `instances(expected_next_at) WHERE status = 'up'`** é o que torna a
  varredura barata: o Postgres só percorre instâncias que ainda podem expirar.
- O **índice único parcial em `incidents(monitor_id) WHERE resolved_at IS NULL`** torna
  impossível, no nível do banco, abrir dois incidentes simultâneos para o mesmo monitor.
  A proteção contra corrida vive no schema, não na aplicação.

### Isolamento multi-tenant

Toda query de leitura parte de `org_id` derivado da sessão, nunca de parâmetro de URL.
Toda ingestão parte de `project_id` derivado do hash da chave. Nenhum handler recebe
`org_id` do cliente. Testes de isolamento são parte da Definição de Pronto de toda fase
que toque em dados (§ [ROADMAP](ROADMAP.md)).

---

## 8. Riscos

| # | Risco | Impacto | Mitigação |
|---|---|---|---|
| R-1 | **Falso positivo em deploy** mata a confiança no produto | Fatal | Modelo Monitor/Instance (§ 5); anúncio de saída em `SIGTERM`; `grace` padrão generoso |
| R-2 | **Relógio do cliente errado** distorce a detecção | Alto | Nenhuma decisão de estado usa timestamp do cliente (§ 6.5) |
| R-3 | **Flapping** gera enxurrada de e-mails | Alto | Confirmação por `grace`; cooldown por monitor; e-mail de recuperação só se houve e-mail de queda |
| R-4 | **O próprio Pulse cai** e ninguém é avisado | Alto | Dead man's switch externo: o detector bate em um serviço gratuito de terceiros a cada ciclo (Fase 4) |
| R-5 | **E-mail cai em spam** e o alerta não chega | Alto | SPF/DKIM/DMARC desde a Fase 2; provedor transacional dedicado; registrar `provider_message_id` |
| R-6 | **Explosão de monitores** por slug dinâmico no código do cliente (`monitor: \`job-${uuid}\``) | Médio | Teto de monitores por projeto; slug normalizado e validado; alerta ao dono ao aproximar do teto |
| R-7 | **Chave de API vazada** em repositório público | Médio | Prefixo reconhecível (`plse_live_`) para varredura de segredos; revogação imediata; escopo mínimo (só ingestão) |
| R-8 | Partição de rede do cliente vira **alerta sobre a rede, não sobre a app** | Médio | Fila e reenvio no SDK; texto do e-mail nomeia a ambiguidade honestamente |
| R-9 | Varredura não cabe no orçamento de tempo em escala | Baixo | Índice parcial; particionamento por hash quando necessário (§ 6.3) |

R-1, R-3 e R-4 são os que decidem se o produto sobrevive ao primeiro mês de uso real.
Nenhum deles é um problema de código — todos são de design, e por isso estão resolvidos aqui
e não descobertos depois.

---

## 9. Métricas de sucesso

| Métrica | Alvo | Por quê |
|---|---|---|
| Tempo do `npm install` ao primeiro monitor verde no painel | < 5 min | É a aposta do § 1 |
| Alertas falsos por monitor por mês | < 0,1 | Acima disso, o time desliga o produto |
| Detecção dentro do SLO (`grace` + 15 s) | > 99% | É a promessa central |
| Monitores por projeto após 30 dias | crescente | Indica que confiaram o suficiente para expandir |

A segunda métrica é a mais importante e a mais fácil de ignorar. Um produto de alerta é julgado
pelos alertas errados que envia, não pelos certos.

---

## 10. Decisões registradas

| ADR | Decisão |
|---|---|
| [0001](adr/0001-monorepo-typescript.md) | Monorepo TypeScript com pnpm workspaces |
| [0002](adr/0002-postgres-unico-datastore.md) | Postgres como único datastore no MVP |
| [0003](adr/0003-monitor-instance.md) | Modelo de duas camadas Monitor / Instance |
| [0004](adr/0004-deteccao-por-varredura.md) | Detecção por varredura periódica, não por jobs agendados |
| [0005](adr/0005-sem-persistir-heartbeats.md) | Heartbeats não são persistidos; uptime deriva de incidentes |
| [0006](adr/0006-autoprovisionamento.md) | Monitores são criados pelo primeiro heartbeat |
| [0007](adr/0007-api-keys.md) | Chaves de API com hash, escopo de projeto e prefixo reconhecível |
| [0008](adr/0008-email-transacional.md) | E-mail via provedor transacional atrás de uma interface |
| [0009](adr/0009-deploy-docker.md) | Deploy em Docker; detector como processo separado |

---

## 11. Decisões em aberto

Nenhuma bloqueia o início do desenvolvimento. Todas têm um padrão assumido para não travar a Fase 1.

| Questão | Padrão assumido | Quando decidir |
|---|---|---|
| Nome e domínio do produto | "Pulse" como nome de trabalho | Antes da Fase 5 (publicação no npm) |
| Autenticação do painel | E-mail + senha com Auth.js; OAuth GitHub depois | Fase 3 |
| ORM: Prisma ou Drizzle | Drizzle — SQL explícito, índices parciais nativos, migrations legíveis | Fase 1, primeiro commit de schema |
| Provedor de e-mail | Resend | Fase 2 |
| Destinatários de alerta | Todos os membros da organização | Fase 2; granularidade por monitor é pós-MVP |
| Retenção de instâncias encerradas | 24 h | Fase 4 |
| Licença | A definir | Antes de publicar |
