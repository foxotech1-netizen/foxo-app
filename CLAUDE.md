@AGENTS.md

## Design system FoxO — règles obligatoires pour toute UI

**Identité.** Esthétique "luxe B2B sobre" : raffinée, dense, professionnelle. Jamais d'esthétique IA générique (cartes flottantes sur fond blanc pur, dégradés violets, emojis décoratifs). L'identité FoxO actuelle (marine / sable / ambre) est LA référence : on la modernise, on ne la remplace pas.

**Typographie.** Titres : Syne. UI : Sora. Texte courant : Inter (chargées via next/font, variables --font-syne / --font-sora / --font-inter). N'introduire AUCUNE autre police. Contrastes de graisse marqués, hiérarchie nette entre niveaux de titres, chiffres tabulaires pour les données.

**Couleurs.** Source de vérité : les tokens @theme de src/app/globals.css — primaire marine #1B3A6B (--color-navy), accent ambre #B8830A (--color-amber-foxo), fonds chauds sable/crème (--color-sand #F5F2EC, --color-cream #FDFBF7), sidebar marine. JAMAIS de couleur hex en dur dans les composants : toujours les tokens. Une seule couleur d'accent par écran ; couleurs sémantiques discrètes.

**Densité.** FoxO est un back-office de gestion : privilégier tableaux denses et lisibles, filtres efficaces, actions accessibles en 1 clic. Pas de grandes cartes aérées façon landing page sur les écrans de travail.

**États obligatoires.** Chaque écran doit gérer : chargement (skeleton), liste vide (message utile + action), erreur (message clair en français). Jamais d'écran blanc.

**Responsive.** Portail technicien = PWA mobile-first (usage terrain, une main, gants possibles : cibles tactiles généreuses). Portails admin et partenaire = desktop-first mais utilisables sur tablette.

**Accessibilité.** Contrastes WCAG AA minimum, navigation clavier fonctionnelle, tailles de texte jamais sous 14px pour le contenu de travail.

**Cohérence.** Avant de créer un nouveau composant, vérifier s'il en existe déjà un similaire dans le code et le réutiliser/étendre. Tout texte visible en français. Aucun vocabulaire métier hardcodé : passer par vocab.ts pour le portail partenaire.

**Méthode.** Pour tout chantier UI significatif : consulter le skill frontend-design avant de coder, et utiliser le skill webapp-testing pour capturer et critiquer visuellement le rendu avant de conclure.
