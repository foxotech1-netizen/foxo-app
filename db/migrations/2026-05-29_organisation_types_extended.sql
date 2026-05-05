-- Extension de l'enum user_role pour les nouveaux types d'organisations
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'courtier';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'assurance';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'expert';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'entrepreneur';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'plombier';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'electricien';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'toiturier';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'chauffagiste';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'autre_metier';

NOTIFY pgrst, 'reload schema';
