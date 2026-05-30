-- =========================================================
-- Migration RGPD — Étape B : moteur d'anonymisation d'un occupant
-- 2026-05-30 — dépend de l'étape A (table rgpd_erasure_logs)
-- Appliquée en prod le 2026-05-30, testée en dry-run (OK)
-- =========================================================

CREATE OR REPLACE FUNCTION public.rgpd_erase_occupant(
  p_occupant_id uuid,
  p_erased_by   text
)
RETURNS public.rgpd_erasure_logs
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_email        text;
  v_phone        text;
  v_intervention uuid;
  v_nb_mails     integer := 0;
  v_nb_sms       integer := 0;
  v_log          public.rgpd_erasure_logs;
BEGIN
  SELECT email, telephone, intervention_id
    INTO v_email, v_phone, v_intervention
  FROM public.occupants
  WHERE id = p_occupant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Occupant % introuvable', p_occupant_id;
  END IF;

  UPDATE public.occupants
  SET nom                = '[efface RGPD]',
      prenom             = NULL,
      telephone          = NULL,
      email              = NULL,
      instructions       = NULL,
      conf               = NULL,
      contact_preference = NULL,
      token              = NULL,
      confirmation_token = NULL,
      erased_at          = COALESCE(erased_at, now())
  WHERE id = p_occupant_id;

  SELECT count(*) INTO v_nb_mails
  FROM public.mails_analyses m
  WHERE (v_email IS NOT NULL AND (m.occupant_email = v_email
            OR m.analyse_raw::text ILIKE '%'||v_email||'%'
            OR m.occupants_extraits::text ILIKE '%'||v_email||'%'))
     OR (v_phone IS NOT NULL AND (m.occupant_telephone = v_phone
            OR m.analyse_raw::text ILIKE '%'||v_phone||'%'
            OR m.occupants_extraits::text ILIKE '%'||v_phone||'%'));

  UPDATE public.mails_analyses
  SET occupant_email     = CASE WHEN v_email IS NOT NULL AND occupant_email = v_email
                                THEN NULL ELSE occupant_email END,
      occupant_telephone = CASE WHEN v_phone IS NOT NULL AND occupant_telephone = v_phone
                                THEN NULL ELSE occupant_telephone END
  WHERE (v_email IS NOT NULL AND occupant_email = v_email)
     OR (v_phone IS NOT NULL AND occupant_telephone = v_phone);

  UPDATE public.mails_analyses
  SET analyse_raw = NULL,
      occupants_extraits = NULL
  WHERE (v_email IS NOT NULL AND (analyse_raw::text ILIKE '%'||v_email||'%'
            OR occupants_extraits::text ILIKE '%'||v_email||'%'))
     OR (v_phone IS NOT NULL AND (analyse_raw::text ILIKE '%'||v_phone||'%'
            OR occupants_extraits::text ILIKE '%'||v_phone||'%'));

  UPDATE public.sms_logs
  SET to_phone = '[efface]',
      message  = '[efface RGPD]'
  WHERE occupant_id = p_occupant_id
     OR (v_phone IS NOT NULL AND to_phone = v_phone);
  GET DIAGNOSTICS v_nb_sms = ROW_COUNT;

  INSERT INTO public.rgpd_erasure_logs
    (occupant_id, intervention_id, erased_by, tables_touched,
     nb_mails_anonymises, nb_sms_anonymises)
  VALUES
    (p_occupant_id, v_intervention, p_erased_by,
     ARRAY['occupants','mails_analyses','sms_logs'],
     v_nb_mails, v_nb_sms)
  RETURNING * INTO v_log;

  RETURN v_log;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rgpd_erase_occupant(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.rgpd_erase_occupant(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.rgpd_erase_occupant(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rgpd_erase_occupant(uuid, text) TO service_role;
