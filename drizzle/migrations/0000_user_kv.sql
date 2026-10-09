CREATE TABLE public.user_kv (
  user_id uuid NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL DEFAULT 'null'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_kv TO authenticated;
GRANT ALL ON public.user_kv TO service_role;
ALTER TABLE public.user_kv ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own kv select" ON public.user_kv FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own kv insert" ON public.user_kv FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own kv update" ON public.user_kv FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own kv delete" ON public.user_kv FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX user_kv_key_idx ON public.user_kv (key);