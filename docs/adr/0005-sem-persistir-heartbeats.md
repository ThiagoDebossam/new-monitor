# ADR-0005 — Heartbeats não são persistidos; uptime deriva de incidentes

**Status:** aceito · **Data:** 2026-08-27

## Contexto

O reflexo natural é gravar cada heartbeat como uma linha e calcular uptime contando batimentos
recebidos contra esperados.

A 30 segundos por instância, 5.000 instâncias geram 14,4 milhões de linhas por dia. Em um mês,
432 milhões — para responder a uma pergunta que ninguém faz ("o batimento das 03:47:12 de
terça chegou?").

## Decisão

Não persistir heartbeats. O heartbeat atualiza estado, não cria histórico:

- **Estado corrente** — uma linha por instância, atualizada em `UPDATE`
- **Incidentes** — uma linha por queda

E uptime se calcula por complemento:

```
uptime(janela) = 1 − (Σ duração dos incidentes ∩ janela) / duração da janela
```

## Consequências

- Armazenamento cresce com incidentes, não com tráfego — RNF-7 é consequência direta
- O cálculo é exato, não amostrado, e custa uma varredura de índice sobre pouquíssimas linhas
- O gráfico do painel é desenhado a partir de intervalos, não de pontos
- Perde-se a auditoria de batimentos individuais. `last_sequence` cobre a necessidade real
  (detectar perda em trânsito) a custo zero
- Se um dia houver demanda por métricas por batimento, o caminho é uma tabela agregada por
  minuto, alimentada em paralelo — não a persistência de eventos crus
