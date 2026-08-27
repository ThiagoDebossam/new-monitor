# ADR-0003 — Modelo de duas camadas Monitor / Instance

**Status:** aceito · **Data:** 2026-08-27

## Contexto

Uma aplicação Node raramente é um processo. São réplicas em um orquestrador, workers do PM2,
containers substituídos a cada deploy. É preciso decidir o que exatamente está "vivo".

## Alternativa rejeitada — modelo plano

Se o monitor fosse a única entidade e qualquer processo pudesse batê-lo, dois defeitos
apareceriam:

1. **Deploy rolling geraria alarme.** A instância antiga morre, a nova ainda não bateu, o
   monitor cai. É o defeito que faz uma equipe desligar o produto (Risco R-1).
2. **Morte parcial passaria batido.** Duas de três réplicas morrem, a terceira segue batendo,
   e o painel diz "verde".

## Decisão

Duas camadas. `Monitor` é a definição lógica e estável; `Instance` é uma execução concreta
(processo + host + boot), identificada por uma chave gerada pelo SDK a cada inicialização.

Uma única regra determina o estado:

> Um monitor está vivo enquanto `count(instâncias vivas) >= min_healthy_instances`.

## Consequências

- Com `min = 1` (padrão), o deploy rolling é silencioso: a nova instância bate antes da antiga
  expirar
- Com `min = N`, quem roda N réplicas é avisado ao perder uma
- A granularidade do alerta é um número que o usuário ajusta, não uma nova entidade a modelar
- Instâncias acumulam a cada restart e precisam de retenção (Fase 4)
- Incidentes pertencem ao monitor, nunca à instância: o usuário quer saber se a aplicação está
  no ar, não qual PID morreu
