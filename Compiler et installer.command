#!/bin/zsh
# Double-cliquez : teste, compile, installe Cours Albert dans /Applications et l’ouvre.
# Le journal complet est écrit dans .build/build.log (lisible par Claude).
cd "${0:A:h}"
mkdir -p .build
LOG=".build/build.log"
: > "$LOG"
say() { print -- "$1" | tee -a "$LOG"; }
fail() { say ""; say "ÉCHEC : $1"; say "Le détail est dans $LOG."; print; read -r '?Appuyez sur Entrée pour fermer…'; exit 1; }
# Met un élément à la Corbeille (récupérable tant qu’elle n’est pas vidée) ; ne supprime jamais définitivement.
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
corbeille() {
  local p="$1"
  [[ -e "$p" || -L "$p" ]] || return 0
  "$LSREG" -u "$p" >/dev/null 2>&1 || true
  local r=$(osascript -l JavaScript -e 'function run(a){ObjC.import("Foundation");return $.NSFileManager.defaultManager.trashItemAtURLResultingItemURLError($.NSURL.fileURLWithPath(a[0]),null,null)?"ok":"non"}' "$p" 2>>"$LOG")
  if [[ "$r" == ok ]]; then say "   → Corbeille : ${p/#$HOME/\~}"; return 0; fi
  say "   ! Pas pu mettre à la Corbeille : ${p/#$HOME/\~}"; return 1
}

say "=== Cours Albert — compilation du $(date '+%d/%m/%Y %H:%M:%S') ==="

say "1/6 Compilation…"
SKIP_DMG=1 ./build.sh >>"$LOG" 2>&1 || fail "la compilation a échoué."
APP=".build/Cours Albert.app"
NODE="$APP/Contents/Resources/node-$( [[ $(uname -m) == arm64 ]] && print arm64 || print x64 )"

say "2/6 Tests du moteur…"
for f in src/sync.mjs src/inside.mjs src/dataset.mjs src/parse.mjs src/organize.mjs src/mirror.mjs src/util.mjs src/classify.mjs src/espaces/*.mjs src/ui/*.js; do "$NODE" --check "$f" >>"$LOG" 2>&1 || fail "erreur de syntaxe dans $f"; done
"$NODE" tests/parse.test.mjs >>"$LOG" 2>&1 || fail "tests de lecture Inside"
"$NODE" tests/dataset.test.mjs >>"$LOG" 2>&1 || fail "tests des données"
"$NODE" tests/integration.mjs >>"$LOG" 2>&1 || fail "tests de rangement et de Drive"
"$NODE" tests/classify.test.mjs >>"$LOG" 2>&1 || fail "tests du tri des cours"
"$NODE" tests/espaces.test.mjs >>"$LOG" 2>&1 || fail "tests des espaces collaboratifs"
"$NODE" tests/assistant.test.mjs >>"$LOG" 2>&1 || fail "tests de l’assistant IA"
"$NODE" tests/nouveautes.test.mjs >>"$LOG" 2>&1 || fail "tests de la 3.1 (Wispr Flow, aperçus, notes, dessin)"
"$NODE" tests/fournisseurs.test.mjs >>"$LOG" 2>&1 || fail "tests des fournisseurs d’IA (Claude, ChatGPT, Gemini, Mistral…)"
"$NODE" tests/affichage.test.mjs >>"$LOG" 2>&1 || fail "tests de l’affichage (aperçus des notes)"

say "3/6 Vérification de la signature…"
codesign --verify --deep --strict "$APP" >>"$LOG" 2>&1 || fail "signature invalide"

say "4/6 Installation dans /Applications…"
NEW="/Applications/Cours Albert.app"
osascript -e 'tell application id "school.albert.cours-sync" to quit' >>"$LOG" 2>&1 || true
sleep 1
pkill -f "/Cours Albert[^/]*\.app/Contents/" 2>/dev/null || true
sleep 1
if [[ -d "$NEW" ]]; then
  OLD=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$NEW/Contents/Info.plist" 2>/dev/null || print ancienne)
  say "   Ancienne version : $OLD"
  if ! corbeille "$NEW"; then
    mkdir -p .build/archives
    rm -rf ".build/archives/Cours Albert $OLD.app"
    ditto "$NEW" ".build/archives/Cours Albert $OLD.app" >>"$LOG" 2>&1 || fail "impossible de mettre de côté l’ancienne app"
    rm -rf "$NEW" >>"$LOG" 2>&1 || fail "impossible de remplacer l’app dans /Applications"
  fi
fi
ditto "$APP" "$NEW" >>"$LOG" 2>&1 || fail "copie dans /Applications"
codesign --verify --deep --strict "$NEW" >>"$LOG" 2>&1 || fail "signature après installation"
NEWV=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$NEW/Contents/Info.plist")
say "   Version installée : $NEWV"

say "5/6 Désinstallation des anciennes versions…"
typeset -aU olds
olds=()
# Copies connues : anciennes apps archivées, image disque préparée, DMG des anciennes versions, copie « pour moi », copie de compilation.
for p in .build/archives/*.app(N) .build/image(N) "Cours Albert "*.dmg(N) "$HOME/Applications/Cours Albert"*.app(N) "/Applications/Cours Albert "*.app(N) "$APP"; do olds+=("${p:A}"); done
# Toutes les autres copies que Spotlight connaît (même identifiant d’app, ou DMG « Cours Albert … »).
while IFS= read -r p; do [[ -n "$p" ]] && olds+=("$p"); done < <(mdfind "kMDItemCFBundleIdentifier == 'school.albert.cours-sync'" 2>/dev/null)
while IFS= read -r p; do [[ -n "$p" ]] && olds+=("$p"); done < <(mdfind "kMDItemFSName == 'Cours Albert*.dmg'c" 2>/dev/null)
n=0
for p in $olds; do
  [[ "$p" == "$NEW" || "$p" == "$NEW"/* ]] && continue
  [[ "$p" == "$HOME/.Trash"/* || "$p" == /Volumes/* ]] && continue
  [[ "$p" == */"Cours Albert $NEWV.dmg" ]] && continue
  [[ "$p" == "$HOME"/* || "$p" == /Applications/* ]] || { say "   (laissé : $p)"; continue; }
  [[ -e "$p" ]] || continue
  corbeille "$p" && (( n++ ))
done
# Images disque « Cours Albert » encore montées : éjectées.
for v in /Volumes/Cours\ Albert*(N); do hdiutil detach "$v" >>"$LOG" 2>&1 && say "   Éjecté : $v"; done
# Agents de fond : ils doivent lancer la nouvelle app (une ancienne version a pu les écrire vers une autre copie).
for label in com.coursalbert.sync com.coursalbert.menubar; do
  plist="$HOME/Library/LaunchAgents/$label.plist"
  [[ -f "$plist" ]] || continue
  prog=$(plutil -extract ProgramArguments.0 raw -o - "$plist" 2>/dev/null)
  if [[ "$prog" != "$NEW/Contents/MacOS/Cours Albert" ]]; then
    plutil -replace ProgramArguments.0 -string "$NEW/Contents/MacOS/Cours Albert" "$plist" >>"$LOG" 2>&1
    if [[ $label == com.coursalbert.sync ]]; then launchctl bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1; launchctl bootstrap "gui/$(id -u)" "$plist" >>"$LOG" 2>&1; fi
    say "   Agent $label → nouvelle app (avant : ${prog/#$HOME/\~})"
  fi
done
"$LSREG" -f "$NEW" >/dev/null 2>&1 || true
say "   $n ancienne(s) copie(s) mise(s) à la Corbeille. Seule reste : $NEW ($NEWV)."
say "   Les données (comptes, espaces, réglages) restent dans ~/Library/Application Support/Cours Albert Sync."

say "6/6 Ouverture…"
open "$NEW"
say ""
say "BUILD OK — Cours Albert $NEWV est installé et ouvert."
sleep 2
