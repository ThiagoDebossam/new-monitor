# ADR-0006 — Monitores são criados pelo primeiro heartbeat

**Status:** aceito · **Data:** 2026-08-27

## Contexto

A aposta do produto é "cinco minutos entre instalar e ver valor". Exigir que o usuário cadastre
o monitor no painel antes de instrumentar a aplicação insere um passo manual entre o `npm
install` e o primeiro sinal verde — e um passo que ele esquecerá ao subir o próximo serviço.

## Decisão

O primeiro heartbeat com um slug desconhecido cria o monitor, com padrões herdados do projeto.
O usuário escreve o slug no código e ele aparece no painel.

## Consequências

- O onboarding é: criar chave, colar duas linhas, rodar
- Novos serviços aparecem sozinhos — o painel reflete a realidade, não o que alguém lembrou de cadastrar
- **Risco:** um slug interpolado no código do cliente (`` monitor: `job-${uuid}` ``) cria monitores
  sem limite. Mitigações obrigatórias:
  - teto de monitores por projeto, com aviso ao dono ao aproximar
  - slug normalizado, com comprimento e conjunto de caracteres validados
  - a criação exige uma chave válida e conta contra o rate limit
- Monitores autoprovisionados nascem com `status = pending` até o primeiro ciclo confirmado,
  para que um erro de digitação não gere alerta imediato
