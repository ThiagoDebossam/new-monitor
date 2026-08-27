# ADR-0009 — Deploy em Docker; detector como processo separado

**Status:** aceito · **Data:** 2026-08-27

## Contexto

O detector ([ADR-0004](0004-deteccao-por-varredura.md)) precisa varrer a cada 10 segundos,
indefinidamente. Plataformas serverless não oferecem processos de longa duração — a varredura
viraria um cron com resolução mínima de um minuto, estourando RNF-2.

## Decisão

Imagens Docker publicadas, executáveis em VPS, Railway ou Fly:

| Container | Papel |
|---|---|
| `web` | Next.js — painel + rota de ingestão |
| `detector` | Varredura e transição de estado |
| `notifier` | Consumo da fila de e-mails |
| `postgres` | Gerenciado em produção |

Detector e notifier são **processos separados**, não `setInterval` dentro do servidor web:

- A detecção continua funcionando com o painel sobrecarregado ou fora do ar (RNF-8)
- Cada um escala, reinicia e é observado independentemente
- Um deploy do painel não interrompe a varredura
- Rodar N réplicas do `web` não multiplica a varredura por N — erro que um `setInterval`
  embutido cometeria silenciosamente

## Consequências

- Exige um alvo de deploy com processos persistentes — decisão já tomada
- O detector precisa tolerar múltiplas réplicas. Tolera: o índice único parcial em incidentes
  abertos torna a operação segura sob concorrência, sem lock distribuído
- O modelo continua compatível com execução em cron, com resolução pior, se um deploy
  serverless for necessário em emergência
- Self-hosting é viável desde o primeiro dia, o que preserva a opção de open source
