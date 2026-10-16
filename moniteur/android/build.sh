#!/usr/bin/env bash
# Compile l'app Android Moniteur PC sans Android Studio (JDK 17+, curl, unzip, zip).
#
#   moniteur/android/build.sh   -> dist/moniteur-pc.apk
set -euo pipefail
A="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$A/../.." && pwd)"
TOOLS_DIR="$ROOT/android"
T="$TOOLS_DIR/.tools"
OUT="$A/build"
VERSION_CODE="${VERSION_CODE:-2}"
VERSION_NAME="${VERSION_NAME:-2.0}"

[ -x "$T/aapt2" ] && [ -s "$T/signer.jar" ] || "$TOOLS_DIR/fetch-tools.sh"

rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/gen"

"$T/aapt2" compile --dir "$A/res" -o "$OUT/res.zip"
"$T/aapt2" link -o "$OUT/unsigned.apk" -I "$T/android.jar" --manifest "$A/AndroidManifest.xml" \
  --java "$OUT/gen" --min-sdk-version 26 --target-sdk-version 29 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" "$OUT/res.zip"

javac -nowarn -Xlint:-options -source 8 -target 8 -bootclasspath "$T/android.jar" \
  -d "$OUT/classes" $(find "$A/src" "$OUT/gen" -name '*.java')
java -cp "$T/r8.jar" com.android.tools.r8.D8 --release --min-api 26 \
  --lib "$T/android.jar" --output "$OUT" $(find "$OUT/classes" -name '*.class')
(cd "$OUT" && zip -q unsigned.apk classes.dex)

java -jar "$T/signer.jar" -a "$OUT/unsigned.apk" -o "$OUT/signed" --allowResign >/dev/null
mkdir -p "$ROOT/dist"
cp "$OUT"/signed/*.apk "$ROOT/dist/moniteur-pc.apk"
echo "APK : $ROOT/dist/moniteur-pc.apk"
