# Développer Cours Albert 3 (3.3)

## Architecture

| Fichier | Rôle |
| --- | --- |
| `src/App.m` | App Cocoa : fenêtre (WKWebView + barre latérale translucide), menus, barre des menus, notifications, pont JavaScript, réglages, installation, LaunchAgents. Lance et surveille le **serveur des espaces**, charge l’interface depuis lui (`http://127.0.0.1:<port>/app/index.html`, copie `file://` en secours), ouvre les `.md`, textes et `.coursalbert` reçus du Finder, exporte PDF/PNG et enregistre les fichiers |
| `src/espaces/server.mjs` | Serveur HTTP local des espaces : API propriétaire sur `127.0.0.1` (jeton `CA_TOKEN`), partage sur le réseau local (`0.0.0.0`, clés de partage, identité des invités), temps réel (SSE), médias avec Range, page invités `/s/<id>`, lecture/écriture des notes (`/api/file`), liens `[[…]]` du vault, IA facultative |
| `src/espaces/model.mjs` | Modèle pur : validation de tout ce qui entre, droits (`can`, `resolveAccess`), vues par participant (votes anonymisés, publications en attente ou programmées masquées) |
| `src/espaces/store.mjs` | Stockage : un dossier par espace (`space.json` + `.bak`, `media/`), enregistrement atomique différé, brouillons, médias (taille, dimensions, SVG vérifiés) |
| `src/espaces/exporter.mjs` | CSV, Excel (XLSX écrit à la main, plusieurs feuilles), ZIP (écriture et lecture), sauvegarde `.coursalbert` |
| `src/espaces/preview.mjs` | Aperçus de liens (Open Graph) sans accès aux adresses privées, intégrations YouTube/Vimeo |
| `src/espaces/ai.mjs` | Réglages de l’IA (clé dans `ia.json`, 0600, modèle) et tri par IA (tâches `organize` et `classify`), SDK Anthropic chargé à la demande |
| `src/espaces/llm.mjs` | Fournisseurs d’IA (3.2) : Claude via le SDK Anthropic, ou adaptateur `OpenAICompatClient` (ChatGPT, Gemini, Mistral, DeepSeek, Grok, Groq, OpenRouter, Ollama, autre URL compatible OpenAI) qui imite `client.beta.messages.create` : conversion des messages `tool_use`/`tool_result` ⇄ `tool_calls`/`role: tool`, identifiants Mistral à 9 caractères, schémas simplifiés pour Gemini, sortie JSON `json_schema` → `json_object` → consigne, liste des modèles (`GET /models`) et choix par défaut. Adresses : https partout, http seulement en local |
| `src/espaces/agent.mjs` | **Assistant IA** (3.1) : boucle d’outils avec le fournisseur choisi (`ai.client()`). Racines : `vault/…` (modifiable), `cours/…` (bibliothèque de l’app, lecture seule), `notes-…/…` (dossiers de notes, modifiables). Outils : lister, lire, chercher, cours, créer un dossier, déplacer (met à jour les liens `[[…]]`), écrire une note, espaces (lister, lire, créer, publier avec fichiers liés, organiser), rangement du vault (`90_Meta/Rangement/ranger_cours.py` s’il existe), plus les outils des extensions (Wispr Flow). Aucun outil de suppression ; protections : bibliothèque, dossiers cachés, projets de code, règles `Assistant/regles.json`. Journal `Assistant/journal.json` pour l’annulation, conversations dans `Assistant/conversations/`. Lit `CLAUDE.md`/`ASSISTANT.md` à la racine du vault |
| `src/espaces/thumbs.mjs` | Aperçus miniatures (3.1) avec `qlmanage -t` (Quick Look), cache `Apercus/`, deux calculs à la fois, échecs mémorisés 10 min ; rien hors macOS |
| `src/espaces/wispr.mjs` | Connexion Wispr Flow (3.1) : découverte OAuth (RFC 9728/8414), enregistrement dynamique du client, PKCE, retour sur `http://127.0.0.1:<port>/api/wispr/callback`, client MCP HTTP (JSON ou SSE, session, rafraîchissement du jeton). Import des notes et réunions (vers `vault/00_Inbox/Wispr` puis `ranger_cours.py --ingest-dir`, sinon dossier de notes « Wispr Flow »), toutes les 30 min. Jetons dans `wispr.json` (0600). Extension de l’assistant : `wispr_chercher`, `wispr_lire`, `wispr_importer` |
| `src/classify.mjs` | Tri des supports par catégorie et rang (TD1 < TD2, corrigé après le sujet), suggestions de cours pour « À classer » |
| `src/ui/` | Interface : `core.js` (outils, icônes, fenêtres, menus, glisser-déposer), `md.js` (Markdown façon Obsidian + lecteur de fichiers), `app.js` (pont), `views.js` (barre latérale, Albert School, Cours), `main.js` (démarrage, réglages, recherche), `esp-*.js` (espaces : tableau de bord, tableaux, publications, disposition libre, carte, panneaux, espace libre), `guest.html`/`guest.js` (page des invités), `vendor/` (KaTeX, QR code, carte Natural Earth ; licences dans `vendor/licences`) |
| `src/sync.mjs`, `inside.mjs`, `parse.mjs`, `dataset.mjs`, `organize.mjs`, `mirror.mjs`, `util.mjs` | Moteur de synchronisation d’Inside, Drive et Bureau (inchangé dans son principe ; `organize.mjs` et `dataset.mjs` utilisent `classify.mjs` et `classement.json`) |
| `tests/` | `parse.test.mjs`, `dataset.test.mjs`, `integration.mjs`, `classify.test.mjs` (tri des cours), `espaces.test.mjs` (serveur des espaces de bout en bout), `assistant.test.mjs` (assistant avec un faux client API), `nouveautes.test.mjs` (Wispr Flow avec un faux serveur OAuth/MCP, aperçus, dossiers de notes, calque de dessin). `tests/outils/interface.jsdom.mjs` teste l’interface dans jsdom (outil de développement, non lancé à la compilation) |

### Flux

- Synchronisation : l’app lance `node sync.mjs --config <config.json> [--interactive] [--full] [--data-only]` ; passage horaire par le LaunchAgent `com.coursalbert.sync` (`Cours Albert --background`).
- Espaces : l’app lance `node espaces/server.mjs --support <dossier> --ui <Resources/ui> --allow <dossiers de cours>… --vault <vault>` avec le jeton dans `CA_TOKEN` et une entrée standard ouverte (le serveur s’arrête proprement quand elle se ferme). Il écrit `{"ready":true,"port":…,"lanPort":…}` sur sa sortie. Port préféré 47821 (puis +2, +4, +6, libre) ; partage local sur 47822. Redémarrage automatique (5 fois en 10 minutes au plus), avec le même jeton et le même port.
- Données sur le Mac de l’étudiant (`~/Library/Application Support/Cours Albert Sync/`) : `Espaces/<id>/space.json` et `media/`, `Espaces/preferences.json` (nom, dossiers, espaces rejoints, partage local), `classement.json` (ordre et catégories choisis à la main), `ia.json` (clé API, jamais dans le DMG), `espaces.log`, `espaces-erreurs.log`.

### Pont JavaScript

Seule la page principale de l’app, chargée depuis le serveur local ou depuis `Resources/ui`, peut parler à la partie native (contrôle de `frameInfo` : jamais une vidéo intégrée ni un espace rejoint sur un autre Mac).

JS → natif : `window.webkit.messageHandlers.coursAlbert.postMessage({id, action, …})` avec `ready`, `sync`, `open`, `reveal`, `openURL` (http, https, mailto), `openObsidian`, `openICS`, `openGuide`, `openSupport`, `readLog`, `chooseFolder`, `saveSettings`, `install`, `requestNotifications`, `saveClassement`, `saveURL` (téléchargement depuis le serveur local vers un fichier choisi), `exportPDF`, `exportImage`, `notify`.

Natif → JS : `window.CoursAlbert.receive({type, …})` avec `init` (réglages, données, `env.spaces` = port, jeton, base, dossier ou erreur, `classement`), `spaces` (serveur redémarré), `openText`, `importSpace`, `command` (`new-board`, `new-canvas`, `templates`, `import`, `join`, `present`, `share`), `reply`, `data`, `progress`, `syncDone`, `navigate`, `search`, `toast`.

## Développer l’interface sans compiler

Lancer le serveur en mode développement (jeton `dev`, données de démonstration), depuis le dossier du projet :

```
".build/Cours Albert.app/Contents/Resources/node-arm64" src/espaces/server.mjs --dev --support /tmp/ca-dev --ui src/ui --port 47900 --lan-port 47910
```

puis ouvrir `http://127.0.0.1:47900/app/index.html?token=dev&now=2026-09-24T08:40:00Z#/accueil`. Paramètres : `now`, `nodata`, `noconfig`, `progress`, `token`. Routes : `accueil`, `e/<id>` (espace), `j/<id>` (espace rejoint), `today`, `planning`, `examens`, `absences`, `cours`, `cours/<id>`, `sync`, `reglages`. La page invité d’un espace partagé s’ouvre à `http://127.0.0.1:47900/s/<id>?k=<clé>` (clé dans le bouton Partager) ; les téléphones passent par le port du réseau local (47910 ici) une fois le partage activé.

## Compiler, tester, installer

Double-cliquer sur `Compiler et installer.command` : compilation universelle (`build.sh`, `SKIP_DMG=1`, tous les `src/espaces/*.mjs` copiés et imports vérifiés), vérification de syntaxe de tous les modules, tests avec le Node embarqué, vérification de signature, remplacement de `/Applications/Cours Albert.app` (l’ancienne version va à la Corbeille), désinstallation des autres copies (Corbeille, jamais de suppression définitive ; agents de fond repointés vers la nouvelle app), ouverture. Journal : `.build/build.log`. `build.sh` refuse de construire si un fichier personnel (`ia.json`, `classement.json`, `config.json`, `preferences.json`, `demo-data.json`) se retrouve dans l’app.

Pour le DMG à partager : `./build.sh` (sans `SKIP_DMG`) crée `Cours Albert 3.0.dmg`. Changer `VERSION` dans `build.sh`, `kVersion` dans `App.m`, `VERSION` dans `src/espaces/server.mjs` et `package.json` à chaque livraison.

Prérequis : macOS 12+, outils en ligne de commande (`clang`, `codesign`, `hdiutil`), `rsync`, `curl`. `src/node_modules` contient Playwright 1.62.1 et `@anthropic-ai/sdk` (sinon `npm install` dans `src/`). Node 24.21.0 est téléchargé par `build.sh` et vérifié par empreinte SHA-256.

## Si Inside change

Les sélecteurs sont dans `src/inside.mjs` (objet `PAGE`) et la lecture des textes dans `src/parse.mjs`. Les tableaux d’Inside portent des attributs `data-label` (Exam, Module, Date, Duration, Session, Coeff, SEB ; Course, Attended, Where you stand ; When, Status) et le planning expose `time[datetime]`. Vérifier avec `tests/parse.test.mjs` après toute modification.

## Nouveautés 3.1 : où regarder

- **Interface** : `ui/assistant.js` (vue Assistant, flux NDJSON de `/api/assistant/chat`, annulation), `ui/notes.js` (route `notes/<dossier>/<sous-dossier>`, note rapide, création, ouverture dans `TextViewer` avec `{ edit: true }`), `ui/connexions.js` (carte Wispr Flow des Réglages, évènement `wispr` du flux propriétaire), `ui/esp-ink.js` (calque de dessin et de texte des tableaux : carte `ink` de l’espace, objets `path` et `text` du même format que l’espace libre ; enveloppe `E.renderBoard`).
- **Serveur** : `/api/assistant*`, `/api/notes*` (dossiers dans `Espaces/preferences.json` › `noteFolders`, autorisés comme la bibliothèque), `/api/wispr*` (dont `/api/wispr/callback`, sans jeton mais vérifié par `state`), `/thumb/<espace>/<pièce jointe ou objet>` (droits de l’espace) et `/thumb?path=` (propriétaire). La carte `ink` d’un tableau est créée au premier trait (`store.card`).
- **Lecteur de notes** (`md.js`) : enregistrement automatique 1,5 s après la frappe.
- **Natif** (`App.m`) : les dossiers de notes sont acceptés par `open`/`reveal` ; message du sélecteur pour `chooseFolder` avec `purpose: 'notes'`.

## Nouveautés 3.2 : où regarder

- Réglages › IA : menu « Fournisseur » (`aiCard` dans `ui/main.js`), une clé par fournisseur gardée dans `ia.json` (`keys`, `models`, `urls`, `lists` ; l’ancien `apiKey` Claude est repris au chargement), bouton « Liste » → `GET /api/ai/models`.
- `ai.mjs` : `current()`, `client()`, `listModels()`, `extras()` (paramètres propres à l’API officielle de Claude) ; `agent.mjs` passe par `ai.client()`.
- Adresse de l’API modifiable pour **tous** les fournisseurs (champ vide = adresse officielle). Une adresse autre que l’officielle a sa propre clé et son propre modèle (`keys['openai:custom']`, `keys['anthropic:custom']`…), donc la vraie clé n’est jamais écrasée. Claude par une passerelle compatible Anthropic : clé et modèle libres, ni `betas` ni `output_config` (le format JSON passe par la consigne système). Claude reste « recommandé » en tête de liste.
- Tests : `tests/fournisseurs.test.mjs` (fausse API compatible OpenAI : tri JSON avec repli, assistant avec appel d’outil, retour à Claude), `tests/outils/interface.jsdom.mjs` (changement de fournisseur dans les réglages).

## Nouveautés 3.3 : où regarder

- `ui/esp-view.js` : barre du bas des tableaux (curseur de défilement horizontal pour les colonnes et la frise, bouton « Aperçus », curseur de taille 60–160 % façon Finder, « Tout replier »), colonnes repliables (bouton ‹ dans l’en-tête, clic sur la colonne repliée pour la rouvrir). Réglages par personne et par espace dans `localStorage` (`cours-albert.vue.<id>`), appliqués après chaque `renderSpace`/`renderBoard`. Raccourcis ⌥⌘+ / ⌥⌘−.
- CSS (fin de `espaces.css`) : `--z` règle la largeur des colonnes/cartes (`--cwb`, `--gwb`, `--twb` selon la taille du thème) et la hauteur des aperçus ; barres de défilement toujours visibles ; badges de type colorés (`E.fileType`, `E.fileBadge` dans `esp-core.js`, classes `ft-pdf`, `ft-doc`…).
- `espaces/thumbs.mjs` : `textPreviewSVG` — aperçus clairs (SVG, texte échappé) pour `.md`, `.txt`, `.csv`, `.json`… au lieu de Quick Look (sombre). Test : `tests/affichage.test.mjs`.
- `App.m` : Présentation › Agrandir / Réduire l’interface / Taille réelle (⌘+, ⌘−, ⌘0 ; `pageZoom` mémorisé dans les préférences).
- Une publication sans titre ni texte n’a plus de bloc vide sous sa pièce jointe.

## 3.3.1

- Assistant : « Invalid `signature` in `thinking` block » corrigé. `agent.mjs` ne renvoie que les blocs de réflexion de la demande en cours (`forAPI`, `turnStart`), ne compacte que les demandes précédentes, et refait un essai sans aucun bloc de réflexion si l’API refuse encore une signature. Test dans `tests/assistant.test.mjs`.
- Sections repliables aussi dans le mur, la grille et le flux (flèche à gauche du titre, « Tout replier » dans la barre du bas).

## 3.3.2

- Assistant : nouveaux outils pour les **dossiers de l’Accueil** (pastilles qui classent les espaces, `prefs.folders` et `space.folder`) : `creer_dossier_accueil`, `ranger_espaces` (crée le dossier s’il manque, plusieurs espaces d’un coup), `renommer_dossier_accueil` ; `lister_espaces` montre les dossiers et le dossier de chaque espace. Annulation : opérations `folder-create`, `space-folder`, `folder-rename` dans le journal.
- Consignes système réécrites (`systemPrompt`) : ce qu’est l’app, page par page ; les trois sens de « dossier » (Accueil, vault, notes) ; ranger l’Accueil par matière ; ce que l’assistant ne peut pas faire (code, réglages, suppression, texte des PDF) ; réponses plus courtes ; les parties « développement » de `CLAUDE.md` du vault sont ignorées.
- Test : `tests/assistant.test.mjs` (renommage, création, rangement par matière, annulation complète).
