# ADR-0004 — Detecção por varredura periódica

**Status:** aceito · **Data:** 2026-08-27

## Contexto

É preciso detectar a *ausência* de um evento. Nada acontece quando a aplicação morre — é o
silêncio que precisa disparar algo.

## Alternativa rejeitada — jobs agendados

Agendar, a cada heartbeat, um job para o momento em que o próximo deveria chegar (BullMQ com
delay), cancelando-o quando o heartbeat chega. Preciso ao segundo, mas:

- Cada heartbeat vira um cancelamento e um agendamento: ~340 operações de fila por segundo
  para o mesmo resultado
- Traz Redis para a stack, contrariando [ADR-0002](0002-postgres-unico-datastore.md)
- Cria um modo de falha desagradável: um job perdido é uma falha *silenciosa em detectar
  falhas* — exatamente o que não se pode ter em um produto de monitoramento

## Decisão

Uma varredura a cada 10 segundos:

```sql
SELECT id, monitor_id FROM instances
WHERE status = 'up' AND expected_next_at < now()
LIMIT 1000;
```

Sustentada por um índice parcial:

```sql
CREATE INDEX instances_expiring_idx ON instances (expected_next_at) WHERE status = 'up';
```

## Consequências

- O custo é proporcional ao número de instâncias *expiradas*, não ao total
- Idempotente e sem estado externo: reiniciar o detector não perde nem duplica detecção
- Pior caso de atraso é o período da varredura — 10 s atende RNF-2 (≤ 15 s) com folga
- Escala por particionamento de faixa de hash do monitor, sem mudança de modelo
- Rodar como cron a cada minuto continua funcionando, com resolução pior — o que mantém o
  deploy serverless como opção de emergência
