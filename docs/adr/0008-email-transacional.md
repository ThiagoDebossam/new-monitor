# ADR-0008 — E-mail via provedor transacional atrás de uma interface

**Status:** aceito · **Data:** 2026-08-27

## Contexto

O e-mail *é* o produto no momento que mais importa: quando a aplicação do cliente caiu. Um
alerta que chega em spam, ou vinte minutos depois, é equivalente a nenhum alerta.

## Decisão

Uma interface `EmailProvider` com três implementações:

| Implementação | Uso |
|---|---|
| `ResendProvider` | Produção |
| `SmtpProvider` | Mailpit em desenvolvimento; instalações self-hosted |
| `MemoryProvider` | Testes — asserções sobre o que seria enviado |

Resend é o padrão pela boa DX e integração com React Email. A interface existe porque
entregabilidade é o tipo de coisa que obriga a trocar de fornecedor.

## Requisitos não negociáveis

- SPF, DKIM e DMARC configurados e verificados antes do primeiro envio real (Risco R-5)
- `provider_message_id` registrado em toda entrega, para rastrear até o log do fornecedor
- Envio assíncrono, fora do caminho da varredura: o detector enfileira, o notifier envia
- Reenvio com backoff em falha do fornecedor
- Todo e-mail de queda responde, no assunto: o que caiu, desde quando

## Consequências

- Testes não dependem de rede nem de fornecedor
- Trocar de fornecedor é implementar uma interface
- Domínio de envio dedicado, separado do domínio institucional: reputação de e-mail
  transacional não se mistura com marketing
