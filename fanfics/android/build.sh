#!/usr/bin/env bash
# Compile l'app Android Mes Fanfics sans Android Studio (JDK 17+, curl, unzip, zip).
#
#   fanfics/android/build.sh   -> dist/mes-fanfics.apk
set -euo pipefail
A="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$A/../.." && pwd)"
TOOLS_DIR="$ROOT/android"
T="$TOOLS_DIR/.tools"
OUT="$A/build"
VERSION_CODE="${VERSION_CODE:-16}"
VERSION_NAME="${VERSION_NAME:-4.6}"

[ -x "$T/aapt2" ] && [ -s "$T/signer.jar" ] || "$TOOLS_DIR/fetch-tools.sh"

rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/gen" "$OUT/assets"
# L'interface est la même que la version navigateur : fanfics/web.
cp "$A/../web/"*.html "$A/../web/"*.js "$A/../web/"*.css "$OUT/assets/"

"$T/aapt2" compile --dir "$A/res" -o "$OUT/res.zip"
"$T/aapt2" link -o "$OUT/unsigned.apk" -I "$T/android.jar" --manifest "$A/AndroidManifest.xml" \
  -A "$OUT/assets" --java "$OUT/gen" --min-sdk-version 26 --target-sdk-version 29 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" "$OUT/res.zip"

javac -nowarn -Xlint:-options -source 8 -target 8 -bootclasspath "$T/android.jar" \
  -d "$OUT/classes" $(find "$A/src" "$OUT/gen" -name '*.java')
java -cp "$T/r8.jar" com.android.tools.r8.D8 --release --min-api 26 \
  --lib "$T/android.jar" --output "$OUT" $(find "$OUT/classes" -name '*.class')
(cd "$OUT" && zip -q unsigned.apk classes.dex)

java -jar "$T/signer.jar" -a "$OUT/unsigned.apk" -o "$OUT/signed" --allowResign >/dev/null
mkdir -p "$ROOT/dist"
cp "$OUT"/signed/*.apk "$ROOT/dist/mes-fanfics.apk"
echo "APK : $ROOT/dist/mes-fanfics.apk"
