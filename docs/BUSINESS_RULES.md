# 11. Regras de negócio

Percentuais em fração salvo indicação. Arquivo de cada regra entre parênteses.

## Motor de scalp (`lib/scalp.ts`, `histogram.ts`)
- Janela viva de **180 s** (`WINDOW_MS`), 1 ponto/s, mínimo 30 ticks (`MIN_TICKS`).
- Histograma de **20 caixas** (`BIN_COUNT`); a caixa mais frequente é o **ímã** = alvo.
- `NET_TARGET_PCT = 0,35%`, `FEE_ROUND_TRIP_PCT = 0,20%`, `GROSS_TARGET_PCT = 0,55%`.
- Gatilho = ímã ÷ 1,0055; stop = gatilho ÷ 1,0055.
- Perigo/velocidade: queda de 5 s (`VELOCITY_MS`) > 3 desvios (`VELOCITY_SIGMA`).
- Folga mínima preço→gatilho `MIN_GAP_PCT = 0,10%`.
- Versões: `baseline-1.0.0` e `stable-cluster-1.0.0` (modo com bloqueio de cluster instável).

## Qualidade do dado (`feed-quality.ts`)
- Idade máxima da última leitura `MAX_AGE_MS = 3 s`; cobertura mínima `MIN_COVERAGE = 60%`. Dado velho/incompleto nunca gera sinal.
- Preenchimento de buracos mantém último preço por até 20 s (`MAX_HOLD_SECONDS`).

## Filtros (`filters.ts`, `trend.ts`, `correlation.ts`, `magnet-metrics.ts`) — só bloqueiam
- Faixa da janela entre 0,15% e 3% (valores em %). Spread máx 0,08%; escorregamento máx 0,05%; livro ≥ 3× o tamanho da operação.
- Tendência: inclinação de 180 s ≥ 0,25% ou queda recente que é ≥ 60% de continuação → bloqueia.
- Correlação: grupos de pares; aberturas no mesmo grupo em 10 min contam como exposição simultânea.
- Cluster estável: concentração ≥ 12%, vantagem 1ª/2ª ≥ 1%, deriva ≤ 0,2%.
- Requisito não mensurável → no modo aprimorado, não gera sinal.

## Execução e custos (`execution.ts`, `cost-tiers.ts`)
- Regime pela faixa: calmo ≤ 0,35%, agitado ≥ 1,2%. Escorregamento de fallback por regime.
- Latência padrão 1.200 ms; +0,02% de escorregamento por segundo de atraso.
- Tick estimado quando o real não existe. Tiers de liquidez A/B/C pelo ranking de volume 24h — sugestão editável.

## Apostas (`hooks/useBets.ts`)
- Status: `pending` (aguardando gatilho) → `open` (valendo) → `win` | `loss`. Nenhuma aposta expira.
- Arma quando o preço **cruza** o gatilho no sentido em que estava no registro. No tick do acionamento não resolve; alvo/stop só nos ticks seguintes.
- `win` quando preço ≥ alvo; `loss` quando ≤ stop. Aposta com alvo ≤ entrada ou stop ≥ entrada nunca resolve.
- Resolve apostas de **todas** as moedas com preço conhecido, não só a da tela.
- Campos travados (gatilho, alvo, stop, createdAt, priceAtCreate, stake, alavancagem, moedas, câmbio, combo) são restaurados se alguma atualização tentar mudá-los.
- Linha do tempo só acrescenta eventos; evento "preço" no máximo a cada 30 s.
- Resultado líquido: vitória +0,35%, derrota −0,75% (já com taxas), × alavancagem × stake. Apostas abertas descontam taxa também.
- Nada é apagado automaticamente.

## Banca (`useBankroll.ts`)
- Valor inicial, valor por aposta, moeda BRL/USDT, alavancagem padrão 5x. Opção de travar stake = inicial × alavancagem. Stake 0 → Supremo não aposta.

## Totais em moeda (`fx-totals.ts`, `money.ts`)
- Base USDT. Nunca soma moedas diferentes sem conversão. Cotação USDT/BRL com mais de 5 min = velha → valor fica fora do total como "aguardando cotação".

## Supremo (`supremo.ts`, `supremo-live.ts`, `useSupremoAuto.ts`)
- Universo: top 60 por volume, volume mínimo US$ 1 milhão (padrões).
- Faixas fixas de **0,25%** do preço (`BAND_PCT`). Nova visita só conta após 5 s fora (`REVISIT_GAP_MS`). **Índice** = repetições da faixa mais visitada na última hora. Mínimo 3 (`MIN_REPETICOES`).
- Plano: alvo = centro da faixa top (ou a 2ª se o preço já está nela/acima); gatilho = alvo ÷ 1,0055; stop = gatilho ÷ 1,0055. A combinação ativa do laboratório (`supremo-active-combo-v1`) pode trocar alvo/stop.
- Bloqueios ao vivo: `dados-velhos` (>3 s), `cobertura` (<60%), `parado` (últimos 60 s sem variação), `perigo`, `indice-baixo`, `sem-alvo`, `trauma`.
- Ciclo a cada **60 s**, uma geração por vez por aba. Ordena por índice, depois segundos no ímã; escolhe a primeira sem bloqueio e sem bloqueio de exposição. Registra auditoria (últimos 60 ciclos).
- Exposição: **sem intervalo mínimo no tempo** — com o automático ligado, cada ciclo de 60 s cria aposta assim que existe moeda liberada. Limites que ainda valem: máx. 2 ativas no total (pendentes + valendo), máx. 3 valendo, máx. 1 por moeda, não repete mesma moeda+combinação, 1 por grupo correlacionado.
- Simulação/backtest: mesma vela tocando alvo e stop = derrota. Amostra: <30 pequena, ≥100 forte.

## Trauma da moeda (`supremo-trauma.ts`)
- Entra quando ocorre `perigo` (queda de 5 s > 3σ da própria moeda).
- Estabilização: 60 s sem nova mínima, oscilação ≤ 0,50%, dados ≤ 3 s, cobertura ≥ 60%, sem novo perigo.
- Depois, cooldown de **5 min**; no fim, precisa passar por todos os bloqueios normais. Qualquer falha reinicia o trauma.
- Persistido em `supremo-trauma-v1`. Texto informa queda, desvio, limite e o que falta; diz que é condição técnica, não garantia.

## Replay (`replay.ts`)
- Sem look-ahead; resolução começa no segundo seguinte ao toque, com atraso. Cooldown entre operações 10 min; expiração 1 h. Ambiguidade: política `conservadora` (padrão, perda), `excluir`, `otimista`.
- Splits treino/validação/teste por tempo e walk-forward.

## Métricas (`metrics.ts`)
- Expectativa líquida, acerto de empate, fator de lucro, rebaixamento, pior sequência, intervalo de Wilson. Amostra significativa ≥ 30, fraca < 100.

## Laboratório (`target-stop-lab.ts`)
- Mesmas candidatas do backtest, troca só alvo/stop; até 400 combinações; amostra mínima 30. Modos `percentual` e `fixo-ima`.

## Validação de payload (`bet-schema.ts`)
- Pernas entre 0,10% e 5%, divergência de preço ≤ 50%, alvo > gatilho > stop, perda líquida negativa. Herança da gravação em `auto_bets` (não usada hoje para gravar).
