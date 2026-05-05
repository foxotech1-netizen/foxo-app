-- Sprint C : Sync acps ↔ clients
-- Ajoute clients.acp_id (FK vers acps) + trigger AFTER INSERT/UPDATE
-- sur acps pour maintenir automatiquement un client miroir de type='acp'.
-- La table acps reste source de vérité (maître).
-- Appliqué en prod le 2026-05-30.

-- 1. Lien explicite
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS acp_id uuid REFERENCES public.acps(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_acp_id
  ON public.clients (acp_id) WHERE acp_id IS NOT NULL;

-- 2. Trigger fonction
CREATE OR REPLACE FUNCTION public.sync_acp_to_client()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid;
BEGIN
  SELECT id INTO v_client_id FROM public.clients
  WHERE acp_id = NEW.id LIMIT 1;

  IF v_client_id IS NULL THEN
    SELECT id INTO v_client_id FROM public.clients
    WHERE type = 'acp' AND lower(nom) = lower(NEW.nom) LIMIT 1;
  END IF;

  IF v_client_id IS NOT NULL THEN
    UPDATE public.clients SET
      nom                  = NEW.nom,
      adresse              = NEW.adresse,
      code_postal          = NEW.code_postal,
      ville                = NEW.ville,
      pays                 = 'Belgique',
      bce                  = NEW.bce,
      email_rapports       = COALESCE(NEW.email_rapports, NEW.email_rapport),
      email_factures       = COALESCE(NEW.email_factures, NEW.email_facturation),
      email_communications = NEW.email_communications,
      syndic_id_ref        = NEW.syndic_id_ref,
      acp_id               = NEW.id,
      updated_at           = now()
    WHERE id = v_client_id;
  ELSE
    INSERT INTO public.clients (
      type, nom, adresse, code_postal, ville, pays,
      bce, email_rapports, email_factures, email_communications,
      syndic_id_ref, acp_id, actif
    ) VALUES (
      'acp', NEW.nom, NEW.adresse, NEW.code_postal, NEW.ville, 'Belgique',
      NEW.bce,
      COALESCE(NEW.email_rapports, NEW.email_rapport),
      COALESCE(NEW.email_factures, NEW.email_facturation),
      NEW.email_communications,
      NEW.syndic_id_ref, NEW.id, true
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Trigger
DROP TRIGGER IF EXISTS trg_sync_acp_to_client ON public.acps;
CREATE TRIGGER trg_sync_acp_to_client
  AFTER INSERT OR UPDATE ON public.acps
  FOR EACH ROW EXECUTE FUNCTION public.sync_acp_to_client();

-- 4. Backfill
UPDATE public.acps SET nom = nom;

NOTIFY pgrst, 'reload schema';
