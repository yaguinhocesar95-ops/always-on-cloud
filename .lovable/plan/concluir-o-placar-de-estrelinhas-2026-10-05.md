# Concluir o Placar de Estrelinhas

## Objetivo
Retomar o aplicativo enviado no arquivo `crip14.zip`, preservar tudo que já está pronto e concluir a exibição e validação do Placar de Estrelinhas.

## Implementação
- Restaurar no projeto os arquivos do aplicativo enviado, sem copiar metadados Git nem arquivos de dependências/compilação.
- Inserir o painel imediatamente abaixo de “Melhor aposta agora” na página principal.
- Inserir o mesmo painel na página Supremo, usando a lista de apostas, pontuação, leitura mais recente, preços e câmbio já disponíveis em cada tela.
- Corrigir incompatibilidades encontradas no painel, incluindo tipagem insegura, controles que não seguem os componentes visuais existentes e qualquer erro de execução no navegador.
- Preservar as regras atuais: apostas antigas sem estrelas ficam fora do placar; leituras duram 24 horas; a linha de referência permanece em 68%; dados continuam locais ao navegador.

## Validação
- Executar os testes existentes, incluindo os 9 testes do ranking/placar.
- Confirmar que as páginas principal e Supremo abrem sem erros.
- Testar visualmente as três abas, filtros, ordenação e exportação CSV em desktop e celular.
- Criar dados de teste somente no navegador durante a validação para conferir apostas com e sem estrelas, sem incorporá-los ao aplicativo.

## Resultado esperado
O Placar de Estrelinhas aparece e funciona nas duas páginas, integrado ao visual atual e validado com cenários reais de interface.

## Observação técnica
O arquivo enviado contém o aplicativo completo que ainda não está no projeto atual. Ele será usado como base; a árvore de rotas gerada não será editada manualmente.
