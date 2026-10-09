CREATE TABLE public.cron_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ran_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL,
  responded int NOT NULL DEFAULT 0,
  total int NOT NULL DEFAULT 0,
  sources text[] NOT NULL DEFAULT '{}',
  probe jsonb,
  cycle jsonb,
  error text
);
GRANT ALL ON public.cron_runs TO service_role;
ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;
CREATE INDEX cron_runs_ran_at_idx ON public.cron_runs (ran_at DESC);