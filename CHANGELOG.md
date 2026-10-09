# Changelog — Ypx Bet

## Aposta de validação: disparo por condição, não por relógio

**Mudança.** O gatilho por tempo (uma aposta de validação a cada 10 minutos) foi
removido. A abertura de aposta agora acontece exclusivamente quando os Filtros
da Fase 4 e a robustez do ímã (`src/lib/magnet-metrics.ts`, Fase 3) aprovam o
sinal — a condição de entrada do motor é o único gatilho.

**Caminho escolhido: (a).** A aposta de validação deixou de existir como evento
separado. Quando a condição é atingida, o robô abre a aposta real normalmente,
sem duplicar em paralelo uma "aposta de validação" equivalente.

A coluna `auto_bets.is_validation_probe` foi preservada no banco (histórico
antigo continua legível) e toda aposta nova nasce com `is_validation_probe =
false`. A exclusão de sondas das métricas de desempenho — taxa de acerto,
expectativa líquida, profit factor — continua valendo para as linhas antigas
(`src/hooks/useMetrics.ts`, `src/hooks/useServerScore.ts`).

**Consequência consciente, não efeito colateral.** Com isso desaparece o probe
de saúde que rodava independente de haver sinal. Ele confirmava, mesmo em
mercado parado, que o robô, o banco e a conexão com a Binance seguiam
funcionando. Essa garantia por gravação periódica não existe mais.

**Monitoramento que substitui o heartbeat.** Em vez de provar vida gravando
aposta, o robô passa a provar vida registrando verificação de condição:

- `job_state.last_condition_check_at` — quando a condição foi avaliada pela
  última vez com dados reais de mercado.
- `job_state.last_signal_at` — quando a condição foi de fato atingida.
- `job_state.condition_checks` — total acumulado de condições avaliadas.
- `job_runs.evaluated` e `job_runs.signals` — mesmos números por rodada.

Assim "o robô rodou e o mercado não deu sinal" (`evaluated > 0`, `signals = 0`)
fica distinguível de "o robô parou de rodar" (`last_condition_check_at` velho).
O painel de status mostra as duas leituras e alerta em vermelho quando passam
mais de 10 minutos sem nenhuma verificação de condição; o alerta âmbar de
rodada velha (5 minutos) foi mantido.

Migração: `drizzle/migrations/0015_crip_condition_check_monitoring.sql`.
