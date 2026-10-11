# YOLO por canal — estado do trabalho

**Status: incompleto; não usar como autorização operacional.** A interface e a configuração existem, mas o gate do permission broker ainda não aplica YOLO às ações dos agentes. A aceitação principal — executar uma tarefa dentro do escopo sem aprovações intermediárias — não foi implementada nem verificada.

## O que foi investigado

- Lidos `AGENTS.md` e `docs/verification/README.md`. Mudanças de servidor/conversa precisam ser verificadas em fixture isolada; não usar app ou dados reais.
- Mapeados `GroupRecord`/`WireGroup`, persistência em `groups.json`, `Store.patchGroup`, `publicGroupState`, o encaminhamento `startGroupTurn` → `runGroupMemberTurn` → `adapter.sendTurn`, e o fold `request.opened`/resposta do permission broker.
- O broker do OpenMausBot controla seus cartões e as decisões de `Full access`/allowlist. O modo e sandbox nativos continuam sendo do provedor/CLI. YOLO não pode ser só texto de prompt nem flag global de bypass.
- Perguntas estruturadas, permissões do computador local e pedidos de ampliação do sandbox têm tratamento próprio e não devem ser autorizados pelo YOLO.

## O que já existe no workspace

Estes itens foram encontrados no código; existência não comprova o fluxo completo:

- `shared/wire.ts`: `GroupYoloPolicy` e `WireGroup.yolo`; campo ausente significa Ask.
- `server/store.ts`: `yolo` participa de `patchGroup`; `Store` grava grupos em `groups.json`. `createGroup` não define política, e os caminhos de importação inspecionados criam grupos sem copiar YOLO: começam em Ask.
- `server/group-yolo.ts` e `server/group-yolo.test.ts`: parsing estrito, avaliação de escopo, diretório por realpath, categorias de ferramentas/integrações, escritas externas, paths sensíveis, operações de segurança e limites. Teste presente, não executado.
- `server/index.ts`: `PATCH /api/groups/:id` valida/canonicaliza a política e rejeita DMs e grupos de pacote instalado. O fold de `request.opened` ainda usa o veredito existente de approval mode e **não chama `groupYoloVerdict`**.
- `src/components/GroupView.tsx`, `src/locales/en.json`, `src/locales/pt-br.json` e `src/locales/source-hashes.json`: controle/painel de escopo, confirmação ao ativar, indicador Ask/YOLO, desligamento e botão Parar execução. `src/components/GroupView.yolo.test.ts` cobre UI; não executado.
- `docs/group-yolo.md`: guia criado, mas declara a ausência da integração do broker. Não deve ser lido como prova de autorização funcional.

## Pendências e riscos

1. **Drivers:** adicionar `GroupYoloTurnScope` efêmero a `SendTurnInput` e `capabilities.groupYolo: "confined"` somente nos drivers com confinamento nativo comprovado. A solicitação delegada focou Claude/Codex e limitações explícitas nos demais; não há esse contrato/capacidade nas declarações atualmente lidas. Nenhum resultado final da fatia de driver foi confirmado antes da pausa.
2. **Broker:** integrar `groupYoloVerdict` ao `request.opened`, derivando grupo, thread, bot, driver e execução do estado/runtime — nunca do prompt, resumo ou conteúdo de ferramentas. Reconsultar política a cada pedido para que desligar YOLO afete a próxima decisão.
3. **Bloqueios e auditoria:** ações fora do escopo/incompatíveis devem ser negadas sem cartão pendente, registradas sem segredos e permitir etapas independentes; preservar perguntas humanas. Informar bloqueio indispensável e não alegar sucesso sem evidência.
4. **Segurança:** comprovar confinamento do provedor a workspace/ferramentas permitidos; obter paths de payloads estruturados. Não ampliar sandbox nem autorizar credenciais, controles de segurança, computador local ou escritas externas não selecionadas.
5. **Tipos e cobertura:** `Group` local em `src/state/store.tsx` ainda não declara `yolo`, embora o wire o envie. Faltam testes comportamentais de integração para Ask, autorização sem cartão, isolamento entre canais/execuções, reload, desativação em tarefa ativa, bloqueio fora do escopo, conteúdo não confiável e drivers incompatíveis.
6. Atualizar `docs/group-yolo.md` após a implementação e rodar testes focados, cenário de servidor em fixture isolada conforme `docs/verification/README.md` e verificação da UI.

## Trabalho delegado anteriormente

- `GroupSettingsUI`: informou ter feito controles, traduções e teste de UI; não verificado nesta sessão.
- `GroupYoloTests`: informou cobertura de política existente; testes não executados.
- `YoloDocs`: criou `docs/group-yolo.md`; integração do broker continua ausente.
- `ScopedDriverEnforcement`: recebeu a tarefa de confinamento nativo. Ao pausar, o contrato/capacidade ainda não apareciam no código lido. Foi solicitado que interrompesse edições e reportasse arquivos/status; essa confirmação final não foi recebida.

## Retomada atual e verificações

Nesta retomada foram relidos este relatório, os contratos de grupo/driver/evento, o dispatch de turno, o fold de permissões, a política e os testes existentes. Não foi implementada lógica nova nem executado teste, build, lint ou cenário isolado. A única alteração desta retomada é este relatório. Nenhuma execução de YOLO foi demonstrada.

**Para retomar:** concluir primeiro o contrato/enforcement dos drivers e, em seguida, integrar o gate do broker com identidade de execução/canal; só então adicionar os testes de integração, atualizar o guia e executar a verificação isolada.
