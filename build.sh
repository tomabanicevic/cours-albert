#!/bin/zsh
# Construit « Cours Albert.app » (universelle, signée localement) et, sauf SKIP_DMG=1, le DMG à partager.
set -euo pipefail
VERSION=3.3.2
BUILD_NUMBER=3.3.2
BASE="${0:A:h}"
BUILD="$BASE/.build"
APP="$BUILD/Cours Albert.app"
RES="$APP/Contents/Resources"
rm -rf "$APP"
mkdir -p "$BUILD/cache" "$RES" "$APP/Contents/MacOS"
make_node() {
  local arch="$1" sha="$2" archive="$BUILD/cache/node-v24.21.0-darwin-$1.tar.xz"
  if [[ ! -f "$archive" ]]; then curl -L --fail --show-error -o "$archive" "https://nodejs.org/download/release/v24.21.0/node-v24.21.0-darwin-$arch.tar.xz"; fi
  [[ "$(shasum -a 256 "$archive" | awk '{print $1}')" == "$sha" ]] || { echo "Empreinte Node.js incorrecte ($arch)" >&2; exit 1; }
  tar -xOf "$archive" "node-v24.21.0-darwin-$arch/bin/node" > "$RES/node-$arch"
  chmod +x "$RES/node-$arch"
}
make_node arm64 6239d4cf92d864487ec8cd3615038f7b67e7f58b77b21cd2f09ea9fbd68065fe
make_node x64 0ae5a24c24bb7d015cd816c5036b3f90f2945aa872fcf54e58da054753b3a299
CLANG_MODULE_CACHE_PATH=/private/tmp/cours-albert-clang clang -arch arm64 -arch x86_64 -mmacosx-version-min=12.0 -fobjc-arc -Wall -Wno-unused-parameter \
  -framework Cocoa -framework WebKit -framework UserNotifications -framework UniformTypeIdentifiers "$BASE/src/App.m" -o "$APP/Contents/MacOS/Cours Albert"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Cours Albert</string>
<key>CFBundleDisplayName</key><string>Cours Albert</string>
<key>CFBundleIdentifier</key><string>school.albert.cours-sync</string>
<key>CFBundleVersion</key><string>$BUILD_NUMBER</string>
<key>CFBundleShortVersionString</key><string>$VERSION</string>
<key>CFBundleExecutable</key><string>Cours Albert</string>
<key>CFBundleIconFile</key><string>CoursAlbert</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleDevelopmentRegion</key><string>fr</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>LSMultipleInstancesProhibited</key><true/>
<key>LSApplicationCategoryType</key><string>public.app-category.education</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSHumanReadableCopyright</key><string>Cours Albert — outil étudiant non officiel pour Albert School.</string>
<key>NSCameraUsageDescription</key><string>Cours Albert utilise la caméra seulement quand vous prenez une photo ou enregistrez une vidéo dans un espace.</string>
<key>NSMicrophoneUsageDescription</key><string>Cours Albert utilise le micro seulement quand vous enregistrez un message audio ou une vidéo dans un espace.</string>
<key>NSLocalNetworkUsageDescription</key><string>Cours Albert partage vos espaces avec les téléphones et ordinateurs de votre réseau Wi-Fi quand vous activez le partage, et ouvre les espaces partagés par d’autres Mac.</string>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/><key>NSAllowsArbitraryLoadsInWebContent</key><true/></dict>
<key>CFBundleDocumentTypes</key><array>
  <dict><key>CFBundleTypeName</key><string>Note Markdown</string><key>CFBundleTypeRole</key><string>Editor</string><key>LSHandlerRank</key><string>Alternate</string><key>LSItemContentTypes</key><array><string>net.daringfireball.markdown</string></array></dict>
  <dict><key>CFBundleTypeName</key><string>Fichier texte</string><key>CFBundleTypeRole</key><string>Editor</string><key>LSHandlerRank</key><string>Alternate</string><key>LSItemContentTypes</key><array><string>public.plain-text</string><string>public.comma-separated-values-text</string><string>public.json</string></array></dict>
  <dict><key>CFBundleTypeName</key><string>Espace Cours Albert</string><key>CFBundleTypeRole</key><string>Editor</string><key>LSHandlerRank</key><string>Owner</string><key>CFBundleTypeIconFile</key><string>CoursAlbert</string><key>LSItemContentTypes</key><array><string>school.albert.cours-sync.espace</string></array></dict>
</array>
<key>UTExportedTypeDeclarations</key><array><dict>
  <key>UTTypeIdentifier</key><string>school.albert.cours-sync.espace</string>
  <key>UTTypeDescription</key><string>Espace Cours Albert</string>
  <key>UTTypeIconFile</key><string>CoursAlbert</string>
  <key>UTTypeConformsTo</key><array><string>public.data</string></array>
  <key>UTTypeTagSpecification</key><dict><key>public.filename-extension</key><array><string>coursalbert</string></array><key>public.mime-type</key><array><string>application/x-coursalbert</string></array></dict>
</dict></array>
<key>UTImportedTypeDeclarations</key><array><dict>
  <key>UTTypeIdentifier</key><string>net.daringfireball.markdown</string>
  <key>UTTypeDescription</key><string>Document Markdown</string>
  <key>UTTypeConformsTo</key><array><string>public.plain-text</string></array>
  <key>UTTypeTagSpecification</key><dict><key>public.filename-extension</key><array><string>md</string><string>markdown</string></array><key>public.mime-type</key><array><string>text/markdown</string></array></dict>
</dict></array>
</dict></plist>
PLIST
cp "$BASE/assets/CoursAlbert.icns" "$RES/CoursAlbert.icns"
for f in sync.mjs organize.mjs mirror.mjs util.mjs parse.mjs inside.mjs dataset.mjs classify.mjs "Guide de démarrage.html"; do cp "$BASE/src/$f" "$RES/"; done
mkdir -p "$RES/espaces"
cp "$BASE"/src/espaces/*.mjs "$RES/espaces/"
mkdir -p "$RES/ui"
rsync -a --delete --exclude 'demo-data.json' --exclude '.DS_Store' "$BASE/src/ui/" "$RES/ui/"
rsync -a "$BASE/src/node_modules/" "$RES/node_modules/"
mkdir -p "$RES/Licences"
tar -xOf "$BUILD/cache/node-v24.21.0-darwin-arm64.tar.xz" node-v24.21.0-darwin-arm64/LICENSE > "$RES/Licences/Node.js.txt"
cp "$BASE/src/node_modules/playwright/LICENSE" "$RES/Licences/Playwright.txt"
cp "$BASE/src/node_modules/@anthropic-ai/sdk/LICENSE" "$RES/Licences/Anthropic-SDK.txt"
cp "$BASE/src/ui/vendor/licences/"*.txt "$RES/Licences/"
# Aucune donnée personnelle dans l’app : ni clé API, ni espaces, ni réglages (ils restent dans ~/Library/Application Support).
if find "$APP" \( -name 'ia.json' -o -name 'wispr.json' -o -name 'regles.json' -o -name 'classement.json' -o -name 'config.json' -o -name 'preferences.json' -o -name 'demo-data.json' \) | grep -q .; then echo "Fichier personnel trouvé dans l’app" >&2; exit 1; fi
# Chaque import relatif des modules embarqués doit exister dans l’app (sinon le serveur ne démarre pas).
for f in "$RES"/*.mjs "$RES"/espaces/*.mjs; do
  for dep in $(grep -oE "from '\./[^']+'" "$f" | sed -E "s/^from '(.*)'$/\1/"); do
    [[ -f "${f:h}/$dep" ]] || { echo "Module manquant dans l’app : ${f:t} importe $dep" >&2; exit 1; }
  done
done
codesign --force --deep --sign - "$APP"
if [[ "${SKIP_DMG:-0}" != 1 ]]; then
  STAGE="$BUILD/image"
  rm -rf "$STAGE"; mkdir -p "$STAGE"
  cp -R "$APP" "$STAGE/Cours Albert.app"
  ln -s /Applications "$STAGE/Applications"
  cp "$BASE/README.md" "$STAGE/Lisez-moi.md"
  hdiutil create -volname "Cours Albert $VERSION" -srcfolder "$STAGE" -format UDZO -imagekey zlib-level=9 -ov "$BASE/Cours Albert $VERSION.dmg"
fi
echo "Construit : $APP ($VERSION)"
