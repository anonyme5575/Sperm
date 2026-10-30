#!/usr/bin/env bash
# Compile Boîte à Blocs en APK hors ligne (WebView + three.js embarqué). Il faut un JDK (17+), curl, unzip et zip.
#
#   blocs/android/build.sh   -> dist/blocs.apk
set -euo pipefail
A="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$(dirname "$A")")"
T="$ROOT/android/.tools"
OUT="$A/build"
[ -x "$T/aapt2" ] && [ -s "$T/signer.jar" ] || "$ROOT/android/fetch-tools.sh"

rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/gen" "$OUT/assets/three"

# Jeu + three.js en local (plus besoin d'internet)
curl -fsSL --retry 3 https://registry.npmjs.org/three/-/three-0.140.0.tgz | tar -xz -C "$OUT" \
  package/build/three.min.js package/examples/js/controls/OrbitControls.js
cp "$OUT/package/build/three.min.js" "$OUT/package/examples/js/controls/OrbitControls.js" "$OUT/assets/three/"
sed -e 's#https://cdn.jsdelivr.net/npm/three@0.140.0/build/#three/#' \
    -e 's#https://cdn.jsdelivr.net/npm/three@0.140.0/examples/js/controls/#three/#' \
    "$ROOT/blocs/index.html" > "$OUT/assets/index.html"

"$T/aapt2" compile --dir "$A/res" -o "$OUT/res.zip"
"$T/aapt2" link -o "$OUT/unsigned.apk" -I "$T/android.jar" --manifest "$A/AndroidManifest.xml" \
  --java "$OUT/gen" --min-sdk-version 24 --target-sdk-version 34 \
  --version-code 1 --version-name 1.0 -A "$OUT/assets" "$OUT/res.zip"

javac -nowarn -Xlint:-options -source 8 -target 8 -bootclasspath "$T/android.jar" \
  -d "$OUT/classes" $(find "$A/src" "$OUT/gen" -name '*.java')
java -cp "$T/r8.jar" com.android.tools.r8.D8 --release --min-api 24 \
  --lib "$T/android.jar" --output "$OUT" $(find "$OUT/classes" -name '*.class')
(cd "$OUT" && zip -q unsigned.apk classes.dex)

java -jar "$T/signer.jar" -a "$OUT/unsigned.apk" -o "$OUT/signed" --allowResign >/dev/null
mkdir -p "$ROOT/dist"
cp "$OUT"/signed/*.apk "$ROOT/dist/blocs.apk"
echo "APK : $ROOT/dist/blocs.apk"
