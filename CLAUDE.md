@AGENTS.md

## Design system FoxO — règles obligatoires pour toute UI

**Identité.** Esthétique "luxe B2B sobre" : raffinée, dense, professionnelle. Jamais d'esthétique IA générique (cartes arrondies flottantes sur fond blanc, dégradés violets, emojis décoratifs).

**Typographie.** Titres : Fraunces. Texte courant et UI : Manrope. INTERDIT : Inter, Roboto, Open Sans, Lato, Arial, polices système. Contrastes de graisse marqués (ex. 300 vs 700), hiérarchie nette entre niveaux de titres.

**Couleurs.** Primaire : #156082 (bleu FoxO). Accent : #A17244 (cuivre). Sidebar : dégradé #2C2A24 → #1A1814. Fonds neutres chauds, pas de blanc pur ni gris froids. Une seule couleur d'accent par écran ; les couleurs sémantiques (succès/erreur/attente) restent discrètes.

**Densité.** FoxO est un back-office de gestion : privilégier tableaux denses et lisibles, filtres efficaces, actions accessibles en 1 clic. Pas de grandes cartes aérées façon landing page sur les écrans de travail.

**États obligatoires.** Chaque écran doit gérer : chargement (skeleton), liste vide (message utile + action), erreur (message clair en français). Jamais d'écran blanc.

**Responsive.** Portail technicien = PWA mobile-first (usage terrain, une main, gants possibles : cibles tactiles généreuses). Portails admin et partenaire = desktop-first mais utilisables sur tablette.

**Accessibilité.** Contrastes WCAG AA minimum, navigation clavier fonctionnelle, tailles de texte jamais sous 14px pour le contenu de travail.

**Cohérence.** Avant de créer un nouveau composant, vérifier s'il en existe déjà un similaire dans le code et le réutiliser/étendre. Tout texte visible en français. Aucun vocabulaire métier hardcodé : passer par vocab.ts pour le portail partenaire.

**Méthode.** Pour tout chantier UI significatif : consulter le skill frontend-design avant de coder, et utiliser le skill webapp-testing pour capturer et critiquer visuellement le rendu avant de conclure.
