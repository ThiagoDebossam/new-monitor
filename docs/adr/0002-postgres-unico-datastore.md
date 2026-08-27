# ADR-0002 — Postgres como único datastore no MVP

**Status:** aceito · **Data:** 2026-08-27

## Contexto

O sistema tem três cargas distintas: escrita frequente de estado (heartbeats), leitura
transacional (painel) e enfileiramento de e-mails. A tentação é usar Redis para estado quente
e uma fila dedicada para notificações.

## Decisão

Somente Postgres no MVP.

## Justificativa

A carga é menor do que parece. Cinco mil instâncias a 30 segundos são ~170 `UPDATE`s por
segundo em uma tabela com índice único — trabalho trivial para Postgres em hardware modesto.
E como heartbeats não são persistidos individualmente ([ADR-0005](0005-sem-persistir-heartbeats.md)),
a tabela não cresce com o tráfego.

O que Postgres dá de graça e que uma stack híbrida custaria a construir:

- Índices parciais, que tornam a varredura barata e a exclusão mútua de incidentes gratuita
- Transações reais entre estado da instância e incidente — sem janela de inconsistência
- Um backup, um ponto de restauração, um lugar para procurar quando algo estiver errado

## Consequências

- Menos peças móveis, menos modos de falha, menos custo operacional
- Fila de e-mails como tabela com `SELECT ... FOR UPDATE SKIP LOCKED` — suficiente para o
  volume de incidentes, que é ordens de magnitude menor que o de heartbeats
- Se a ingestão superar a capacidade de escrita, o caminho é um buffer de escrita agrupada
  antes de trocar de banco
