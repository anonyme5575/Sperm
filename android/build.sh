#!/usr/bin/env bash
# Compile l'app Android Duo sans Android Studio. Il faut un JDK (17+), curl, unzip et zip.
#
#   android/build.sh   -> dist/duo.apk
set -euo pipefail
A="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$A")"
T="$A/.tools"
OUT="$A/build"
VERSION_CODE="${VERSION_CODE:-3}"
VERSION_NAME="${VERSION_NAME:-1.2}"

[ -x "$T/aapt2" ] && [ -s "$T/signer.jar" ] || "$A/fetch-tools.sh"

rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/gen"

# Ressources + manifeste (génère aussi R.java)
"$T/aapt2" compile --dir "$A/res" -o "$OUT/res.zip"
"$T/aapt2" link -o "$OUT/unsigned.apk" -I "$T/android.jar" --manifest "$A/AndroidManifest.xml" \
  --java "$OUT/gen" --min-sdk-version 28 --target-sdk-version 29 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" "$OUT/res.zip"

# Code
javac -nowarn -Xlint:-options -source 8 -target 8 -bootclasspath "$T/android.jar" \
  -d "$OUT/classes" $(find "$A/src" "$OUT/gen" -name '*.java')
java -cp "$T/r8.jar" com.android.tools.r8.D8 --release --min-api 28 \
  --lib "$T/android.jar" --output "$OUT" $(find "$OUT/classes" -name '*.class')
(cd "$OUT" && zip -q unsigned.apk classes.dex)

# Signature (clé de debug : suffisant pour installer l'APK à la main)
java -jar "$T/signer.jar" -a "$OUT/unsigned.apk" -o "$OUT/signed" --allowResign >/dev/null
mkdir -p "$ROOT/dist"
cp "$OUT"/signed/*.apk "$ROOT/dist/duo.apk"
echo "APK : $ROOT/dist/duo.apk"
