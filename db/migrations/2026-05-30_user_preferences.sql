CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme text CHECK (theme IN ('dark-amber', 'warm-light', 'foxo-blue')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_updated_at
  ON public.user_preferences (updated_at DESC);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "self_select_user_preferences" ON public.user_preferences;
CREATE POLICY "self_select_user_preferences"
  ON public.user_preferences FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "self_insert_user_preferences" ON public.user_preferences;
CREATE POLICY "self_insert_user_preferences"
  ON public.user_preferences FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "self_update_user_preferences" ON public.user_preferences;
CREATE POLICY "self_update_user_preferences"
  ON public.user_preferences FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.user_preferences TO authenticated;
