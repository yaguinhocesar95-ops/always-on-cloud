# Ypx Bet — Contexto completo do projeto

Documento para outra IA (ou pessoa) entender e modificar o projeto sem acesso ao Lovable.
Índice:

- Este arquivo — seções 1 a 6, 8 a 10, 12 a 14
- [DATABASE.md](./DATABASE.md) — seção 7 (backend, banco, SQL)
- [BUSINESS_RULES.md](./BUSINESS_RULES.md) — seção 11 (regras de negócio, constantes, fórmulas)

Quando algo não existe, está escrito "não existe". Quando não há certeza, está escrito "não sei".

---

## 1. Visão geral

**Objetivo.** Um terminal de **apostas simuladas (paper trading)** em criptomoedas com preços reais da Binance. Nenhuma ordem real é enviada a corretora. Todo dinheiro é declarado pelo usuário e só existe no navegador.

**Público-alvo.** Um único operador (o dono do projeto) que testa estratégias de scalp por reversão à média. Não há multiusuário.

**Principais funcionalidades.**
1. Preço ao vivo de um par (websocket Binance) e gráfico dos últimos 180 s.
2. Motor de scalp: calcula o "ímã estatístico" (preço mais repetido em 180 s), o gatilho de entrada, o alvo e o stop.
3. Filtros (spread, escorregamento, faixa, tendência, cluster instável etc.) que só bloqueiam sinais.
4. Ranking entre pares monitorados e tabela de decisão (somente leitura).
5. Apostas simuladas em várias listas independentes (manual, "auto2", "auto3", "Supremo"), com acompanhamento até alvo ou stop.
6. **Validar Aposta Supremo**: a cada 60 s analisa as moedas mais negociadas na última hora, escolhe a de maior "índice" (faixa de preço de 0,25% mais revisitada) e registra uma aposta automaticamente.
7. **Trauma da moeda**: memória de queda forte que bloqueia a moeda até ela se estabilizar.
8. Laboratório de alvo/stop (SupremoLab) e backtest por hora.
9. Simulador histórico (replay) com custos, divisão treino/validação/teste e walk-forward.
10. Banca (valor inicial, valor por aposta, alavancagem, moeda BRL/USDT).
11. Sessão única: uma aba por navegador e um aparelho por vez.

**Fluxos do usuário.**
- *Ver sinal e apostar manualmente*: abrir `/` → escolher moeda no seletor → ler gatilho/alvo/stop → registrar aposta → a aposta fica "aguardando gatilho" (`pending`), vira "valendo" (`open`) quando o preço cruza o gatilho, e termina em `win` (alvo) ou `loss` (stop).
- *Configurar banca*: na `/`, painel "Sua banca" → valor inicial, valor por aposta, alavancagem (padrão 5x), moeda.
- *Supremo automático*: na `/`, ligar a geração automática → a cada 60 s o ciclo escolhe uma moeda e registra a aposta na lista Supremo. Página `/supremo` mostra análise detalhada, backtest, ranking ao vivo e a lista Supremo.
- *Replay*: `/replay` → escolher par e período → baixar velas de 1 s → rodar o motor histórico → ver métricas e exportar CSV.
- *Sessão bloqueada*: abrir em outra aba ou aparelho → a anterior mostra "Projeto aberto em outra aba" / "Sessão aberta em outro aparelho" e o botão "Usar aqui".

**Tipos de usuário / permissões.** Não existe login, nem papéis. Qualquer pessoa com a URL usa o app. A única restrição é a sessão única (ver seção 8).

---

## 2. Stack

| Item | Valor |
|---|---|
| Framework | TanStack Start v1 (React 19, SSR), `@tanstack/react-start` 1.168.60 |
| Roteamento | `@tanstack/react-router` 1.170.41, rotas por arquivo em `src/routes` |
| Build | Vite 8.1.5, `@lovable.dev/vite-tanstack-config` 2.25.2 (já inclui Tailwind, React, alias `@`, nitro com alvo Cloudflare Workers) |
| Linguagem | TypeScript ^5.8.3 |
| Estilo | Tailwind CSS ^4.2.1 (configurado em `src/styles.css`, sem `tailwind.config.js`), `tw-animate-css` |
| UI kit | shadcn/ui (Radix UI) em `src/components/ui`, ícones `lucide-react` ^0.575 |
| Gráficos | `recharts` ^2.15.4 |
| Estado servidor/cache | `@tanstack/react-query` ^5.101.1 |
| Estado local | React hooks + `localStorage` + IndexedDB (cache de velas). Não existe Redux/Zustand/Context próprio |
| Validação | `zod` ^3.25.76 |
| Formulários | `react-hook-form` ^7.71.2 instalado; o app usa sobretudo inputs controlados simples |
| Toasts | `sonner` ^2.0.7 |
| Backend | Lovable Cloud (Supabase) — `@supabase/supabase-js` ^2.117.2; só a tabela `active_session` |
| Testes | `vitest` ^5.0.1, `@testing-library/react` ^16.3.3 |
| Lint/format | ESLint 9, Prettier 3 |
| Restos | `drizzle-orm`/`drizzle-kit`/`postgres` (devDeps) e pasta `drizzle/` — herança de versão antiga, **não usados em runtime** |

---

## 3. Estrutura de pastas

```text
.
├── AGENTS.md                 regras técnicas do projeto
├── CHANGELOG.md              histórico de versão antiga (fala de robô no servidor/job_state que NÃO existe mais no código)
├── README.md                 genérico
├── docs/                     esta documentação
├── drizzle/                  migrações antigas de outro banco (auto_bets, job_state, job_runs, job_secrets). Não aplicadas no banco atual
├── drizzle.config.ts         config do drizzle-kit (não usado)
├── supabase/config.toml      só o project_id (gerado)
├── public/                   favicon.ico, robots.txt
├── vite.config.ts            usa defineConfig da Lovable; entry de servidor = src/server.ts
├── vitest.config.ts          ambiente node, inclui src/**/*.test.ts
└── src/
    ├── router.tsx            cria o router e o QueryClient
    ├── routeTree.gen.ts      GERADO, não editar
    ├── start.ts              middlewares: erro, CSRF, attachSupabaseAuth
    ├── server.ts             wrapper SSR que troca erros 500 por página HTML
    ├── styles.css            design system (tokens, fontes, utilitários)
    ├── routes/
    │   ├── __root.tsx        shell HTML, fontes, SingleSessionGuard, Toaster, 404 e erro
    │   ├── index.tsx         tela principal (terminal)
    │   ├── supremo.tsx       Validar Aposta Supremo
    │   └── replay.tsx        simulador histórico
    ├── components/
    │   ├── ui/               shadcn (não editar sem motivo)
    │   ├── BankrollPanel     banca
    │   ├── BetTracker        lista/linha do tempo das apostas
    │   ├── CoinSelector      seletor de par
    │   ├── CostParamsPanel   custos editáveis + sugestão por volume
    │   ├── DecisionRankingTable ranking de decisão (só leitura)
    │   ├── DisclaimerFooter  aviso legal
    │   ├── EntryTriggerDisplay gatilho/alvo/stop do motor
    │   ├── FilterPanel       filtros e modo do motor
    │   ├── LivePriceTicker   preço e livro (bid/ask)
    │   ├── PairRankingCard   ranking entre pares
    │   ├── PriceChart        gráfico 180 s
    │   ├── SettingsMenu      sons de notificação
    │   ├── SingleSessionGuard sessão única
    │   ├── SupremoInsights   estatísticas, exposição, auditoria Supremo
    │   └── SupremoLab        laboratório alvo/stop
    ├── hooks/                ver seção 6
    ├── lib/                  lógica pura (motor, Supremo, trauma, métricas, replay...) — ver BUSINESS_RULES.md
    ├── lib/__tests__/        testes do motor, execução, métricas, ranking, Supremo, trauma, laboratório
    ├── test/                 testes de rotas, fx, laboratório, supremo-live + setup.ts
    └── integrations/supabase/ GERADOS: client.ts, client.server.ts, auth-middleware.ts, auth-attacher.ts, cron-auth.ts, previewAuthStorage.ts, types.ts
```

---

## 4. Rotas / páginas

Todas públicas (não há login). Não existe `_authenticated`.

| Rota | Arquivo | O que faz |
|---|---|---|
| `/` | `src/routes/index.tsx` | Terminal: seletor, preço ao vivo, gráfico, motor (gatilho/alvo/stop), filtros, ranking entre pares, tabela de decisão, banca, 4 listas de apostas (manual `scalp-terminal-bets-v4`, `auto2`, `auto3`, Supremo), **liga o Supremo automático** (`useSupremoAuto`), SupremoInsights e SupremoLab |
| `/supremo` | `src/routes/supremo.tsx` | Universo de moedas por volume, análise por hora, backtest, ranking ao vivo com bloqueios (inclui trauma), detalhe da moeda com gráficos, lista de apostas Supremo (mesma chave `scalp-terminal-bets-supremo-v1`). Não roda o timer automático |
| `/replay` | `src/routes/replay.tsx` | Baixa velas de 1 s da Binance, roda `replayCandles`, mostra métricas, splits, walk-forward e exporta CSV |
| 404 / erro | `__root.tsx` | `NotFoundComponent` e `ErrorComponent` em português |

Cada rota tem `head()` com título próprio. Nenhum loader usa o banco.

---

## 5. Componentes principais

| Componente | Props principais | Usado em | Depende de |
|---|---|---|---|
| `SingleSessionGuard` | `children` | `__root` | `claimSession`/`checkSession`, localStorage |
| `BankrollPanel` | banca e setters de `useBankroll` | `/` | `money.ts` |
| `BetTracker` | lista de apostas, preço ao vivo, `livePrices`, moeda | `/`, `/supremo` | `useBets` (betPnl, betVariation), `money.ts` |
| `CoinSelector` | `symbols, value, onChange, disabled` | `/` | — |
| `CostParamsPanel` | `symbol, params, sources, onFieldChange, onSuggestion` | `FilterPanel` | `suggestCostParams` (server fn), `cost-tiers.ts` |
| `DecisionRankingTable` | pares ranqueados, preços | `/` | `scalp.ts`, `magnet-metrics.ts`, `filters.ts` |
| `EntryTriggerDisplay` | `engine, fmtPrice, symbol, lastUpdate` | `/` | `ScalpEngine` |
| `FilterPanel` | `engine, mode, onModeChange, symbol` | `/` | `filters.ts`, `useCostParams` |
| `LivePriceTicker` | `price, fmtPrice, status, lastUpdate, book` | `/` | `useLivePrice` |
| `PairRankingCard` | `ranked, stream, selected, onSelect` | `/` | `pair-ranking.ts` |
| `PriceChart` | `data, entryPrice, fmtPrice` | `/` | recharts |
| `SettingsMenu` | — | `/` | `notification-sounds.ts` |
| `SupremoInsights` | apostas Supremo, preços, banca | `/` | `supremo-live.ts`, `fx-totals.ts` |
| `SupremoLab` | — | `/` | `target-stop-lab.ts`, `supremo-data.ts`, `supremo-combo.ts` |
| `DisclaimerFooter` | — | todas | — |

Props exatas: ver o tipo `Props` no topo de cada arquivo.

---

## 6. Estado e dados no front

**Hooks customizados (`src/hooks`).**
- `useLivePrice(symbol)` — websocket `@ticker` + trades da Binance, reconexão exponencial com jitter, fallback REST (no máx. 1/s), guarda 180 s de leituras cruas, livro (bid/ask). Status `connecting|live|reconnecting|offline`.
- `usePairFeeds(symbols)` — 180 s de vários pares; reconecta após 15 s de silêncio; recarrega semente REST a cada reconexão; par sem negócio há 60 s = velho.
- `useAllTickerPrices()` — preços de todos os pares (websocket), no máximo 1 atualização de estado/s. Usado para resolver apostas de qualquer moeda.
- `usePairRanking(...)` — roda o motor e os filtros por par e ranqueia.
- `useBets(symbol, livePrice, quote, livePrices?, storageKey)` — lista de apostas persistida em localStorage; arma, resolve e registra linha do tempo a cada mudança de preço. Ver BUSINESS_RULES.md.
- `useBankroll()` — banca em `scalp-terminal-bankroll-v2`.
- `useCostParams()` — custos em `ypx-cost-params-v1`, com origem (`motor|sugerido|manual`).
- `useSupremoAuto({enabled, ...})` — timer de 60 s, trava global (uma geração por vez por aba), ciclo de seleção e registro.
- `use-mobile` — breakpoint (shadcn).

**Contextos/stores.** Não existe Context próprio nem store global. Só `QueryClientProvider` (no `__root`).

**React Query.** `QueryClient` padrão criado em `router.tsx` (sem opções customizadas). Usado com `useQuery` em `/` e `/supremo` (ex.: lista de pares, cotação USDT/BRL). Não sei os `staleTime` exatos de cada query — conferir os `useQuery` nos arquivos de rota.

**APIs chamadas pelo navegador.** Binance pública (REST `https://api.binance.com` e websockets). Sem chave.

**Chaves de localStorage (todas no navegador, não sincronizam entre aparelhos):**

| Chave | Conteúdo |
|---|---|
| `scalp-terminal-bets-v4` | apostas manuais |
| `scalp-terminal-bets-auto2-v1` | apostas automáticas 2 |
| `scalp-terminal-bets-auto3-v1` | apostas automáticas 3 |
| `scalp-terminal-bets-supremo-v1` | apostas Supremo |
| `scalp-terminal-bankroll-v2` | banca |
| `ypx-cost-params-v1` | custos |
| `supremo-trauma-v1` | estado de trauma por moeda |
| `supremo-exposure-v1` | limites de exposição |
| `supremo-audit-v1` | últimos 60 ciclos de seleção |
| `supremo-active-combo-v1` | combinação alvo/stop ativa |
| `ypx-muted-sounds` | sons silenciados |
| `ypx-device-id` | id do aparelho (sessão única) |
| `ypx-active-tab` | id da aba ativa |

IndexedDB: cache de velas de horas fechadas (`supremo-data.ts`). Nome exato do banco IndexedDB: não sei (ver arquivo).

---

## 8. Autenticação

- **Não existe login, cadastro nem recuperação de senha.** Não há papéis.
- `start.ts` registra `attachSupabaseAuth` (gerado), mas nenhuma função exige usuário.
- **Sessão única** (`SingleSessionGuard`):
  - Aba: cada aba gera `tabId` e grava em `ypx-active-tab`. Evento `storage` de outra aba → bloqueio "tab". Verificado também a cada 10 s.
  - Aparelho: `ypx-device-id` aleatório; ao abrir chama `claimSession` (grava `device_id` na linha `id='main'` de `active_session`); a cada 10 s `checkSession` compara. Se outro aparelho assumiu → bloqueio "device".
  - Bloqueado: o app é desmontado (para de gravar apostas e de gerar Supremo). Botão "Usar aqui" reassume e recarrega.
  - Erros de rede nessas chamadas são ignorados em silêncio (`.catch(() => {})`).
  - Segurança: a tabela é aberta a anônimos; qualquer pessoa pode "roubar" a sessão. É uma conveniência, não uma proteção.

---

## 9. Integrações e variáveis de ambiente

**APIs externas:** Binance (REST e websocket públicos, sem chave). Nenhuma outra.

**Variáveis (`.env`, só nomes):**
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` — cliente do navegador.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PROJECT_ID` — servidor (sessão única usa estas).

**Secrets do backend (só nomes):** `LOVABLE_API_KEY` (não usada no código), `LOVABLE_CRON_SECRET` (usada só por `cron-auth.ts` gerado; não há rota de cron), `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`, `SUPABASE_JWKS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, `SUPABASE_SERVICE_ROLE_KEY` (o código atual não a usa).

**Server functions:** `claimSession`, `checkSession` (`single-session.functions.ts`), `suggestCostParams` (`cost-suggestion.functions.ts`, consulta ticker 24h da Binance e devolve tier A/B/C). Não existem rotas `/api`.

---

## 10. Design system

- Tema "casa de apostas premium": preto + ouro. `<html class="dark">` fixo.
- Fontes (Google Fonts via `<link>` no `__root`): **Barlow Condensed** (títulos, `font-display`), **Barlow** (texto, `font-sans`), **JetBrains Mono** (números, `font-mono`).
- Tokens (oklch) em `:root` de `src/styles.css`: `--background`, `--foreground`, `--surface`, `--surface-2`, `--card`, `--popover`, `--primary` (ouro), `--secondary`, `--muted`, `--accent`, `--destructive` (vermelho), `--success` (verde), `--warning`, `--border`, `--input`, `--ring`, `--gold`, `--gold-deep`, gradientes `--gradient-accent|surface|hairline`, sombras `--shadow-soft|glow`. `.dark` só escurece fundo/texto.
- Aliases Tailwind: `bg-surface`, `bg-surface-2`, `text-success`, `text-warning`, `sbt-red|blue|yellow|green`, `chart-1..`.
- Raio base `0.5rem` (cantos discretos). Títulos condensados em caixa alta.
- Convenção: nunca usar cores fixas (`text-white`, `#hex`) em componentes; usar tokens.

---

## 12. Convenções do código

- Textos da interface e comentários em **português**. Números de dinheiro em formato brasileiro.
- Arquivos: componentes em PascalCase; hooks `useX.ts`; lógica pura em `src/lib/*.ts` em kebab-case; server functions em `*.functions.ts`.
- Lógica de negócio é **pura e testável** em `lib/` (sem rede/relógio); hooks fazem rede e tempo.
- Percentuais internos em **fração** (0,0035 = 0,35%); arredondamento só na tela. Exceção: `TRAUMA_MAX_RANGE_PCT = 0.5` e alguns limites de filtros já estão em "%" (ver BUSINESS_RULES.md).
- Erros: módulos devolvem "motivo legível" em vez de lançar; `try/catch` silencioso em leitura/escrita de localStorage; server functions lançam `Error` com mensagem.
- Validação: `zod` (`bet-schema.ts`, inputs das server functions).
- Persistência local sempre versionada no nome da chave (`-v1`, `-v4`).
- Comentários no topo de cada módulo explicam o que ele pode e não pode mudar ("só bloqueia, nunca cria sinal").

---

## 13. Problemas conhecidos / partes frágeis

1. **Apostas só no navegador.** Limpar dados do navegador apaga tudo. Outro aparelho não vê as apostas.
2. **Várias abas** sobrescreviam as apostas umas das outras; mitigado pelo bloqueio de aba. Apostas perdidas antes disso não voltam.
3. **Sessão única aberta a anônimos** e com erros engolidos em silêncio; se o backend falhar, o bloqueio entre aparelhos para sem aviso.
4. **Supremo só roda com a `/` aberta e visível/não bloqueada.** Aba pausada = sem apostas novas. Navegadores podem atrasar timers em abas de fundo.
5. **Trauma/perigo só são verificados a cada ~60 s** (na busca de velas); quedas entre buscas podem passar.
6. **Nova mínima** do trauma = qualquer mínima menor, sem margem.
7. **Ranking ao vivo do `/supremo`**: moeda em trauma aparece marcada como bloqueada mas pode ficar no topo da lista (ordem não a empurra para baixo). A seleção automática pula moedas com bloqueio.
8. **Uma aposta ativa por moeda** (`maxActivePerCoin=1`, padrão) — uma moeda presa em `open` impede novas apostas nela. O limite total (`maxActiveTotal`) ainda existe no tipo, mas **não é aplicado** em `exposureBlock`.
9. `CHANGELOG.md` e `drizzle/` descrevem um robô no servidor e tabelas (`auto_bets`, `job_state`...) que **não existem** no banco atual. `bet-schema.ts` valida payload de `auto_bets` mas não é usado para gravar nada hoje — não sei se ainda é importado em algum lugar relevante.
10. `useBets` corrige na leitura "vitórias falsas" antigas (resolvidas no mesmo instante do acionamento) voltando-as para `pending`.
11. `routeTree.gen.ts` e `src/integrations/supabase/*` são gerados — não editar.
12. Não há TODO/FIXME marcados no código.

---

## 14. Como rodar

```sh
bun install          # ou npm i
bun run dev          # vite dev, porta 8080 no ambiente Lovable
bun run build        # build de produção (Cloudflare Workers via nitro)
bun run build:dev    # build modo desenvolvimento
bunx vitest run      # testes (cerca de 97)
bun run lint
```

Precisa do `.env` com as variáveis da seção 9. Deploy: pelo botão Publicar do Lovable (URL publicada `https://coin-trauma-guard.lovable.app`). Fora do Lovable, o build gera um Worker Cloudflare; não há outro destino configurado.
