# ADR-0007 — Chaves de API com hash, escopo de projeto e prefixo reconhecível

**Status:** aceito · **Data:** 2026-08-27

## Contexto

O SDK roda em máquinas de clientes e a chave acaba em variáveis de ambiente, arquivos de
configuração e, inevitavelmente, algum repositório público.

## Decisão

- Formato `plse_live_<22 caracteres aleatórios>` (`plse_test_` para ambientes de teste)
- Armazenar apenas o hash SHA-256; o texto claro é exibido uma única vez, na criação
- Guardar `key_prefix` (os primeiros 12 caracteres) para exibição e identificação no painel
- Escopo de **projeto**, não de organização
- Capacidade única: ingerir heartbeats. A chave não lê dados, não lista monitores, não altera
  configuração
- Revogação imediata, com `last_used_at` para identificar chaves ociosas

## Justificativa

O prefixo fixo torna a chave detectável por varredores de segredo — do GitHub e do próprio
usuário. Uma chave que só escreve heartbeats limita o dano de um vazamento a ruído em um
projeto, não a exposição de dados.

SHA-256 sem custo de trabalho é adequado aqui, ao contrário de senhas: a chave tem 128 bits de
entropia real, então não há dicionário a atacar — e a verificação está no caminho quente da
ingestão, onde bcrypt seria inviável.

## Consequências

- Uma chave perdida é irrecuperável, apenas substituível — comportamento esperado e familiar
- O lookup por hash é uma busca em índice único, compatível com RNF-1
- Rotação de chave sem downtime: criar a nova, atualizar as aplicações, revogar a antiga
