#!/usr/bin/env bash
# Compile l'app Android Nettoyeur sans Android Studio. Il faut un JDK (17+), curl, unzip et zip.
#
#   app/build.sh   -> dist/nettoyeur.apk
set -euo pipefail
A="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$A")"
T="$A/.tools"
OUT="$A/build"
VERSION_CODE="${VERSION_CODE:-2}"
VERSION_NAME="${VERSION_NAME:-1.1}"

[ -x "$T/aapt2" ] && [ -s "$T/shizuku-api.jar" ] || "$A/fetch-tools.sh"

LIBS="$(ls "$T"/shizuku-*.jar | paste -sd:)"
rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/gen"

# Ressources + manifeste (génère aussi R.java)
"$T/aapt2" compile --dir "$A/res" -o "$OUT/res.zip"
"$T/aapt2" link -o "$OUT/unsigned.apk" -I "$T/android.jar" --manifest "$A/AndroidManifest.xml" \
  --java "$OUT/gen" --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" "$OUT/res.zip"

# Code (le stub LambdaMetafactory manque dans android.jar ; d8 réécrit les lambdas)
mkdir -p "$OUT/stub/java/lang/invoke" "$OUT/stubc"
cat > "$OUT/stub/java/lang/invoke/LambdaMetafactory.java" <<'J'
package java.lang.invoke;
public class LambdaMetafactory {
  public static CallSite metafactory(MethodHandles.Lookup l, String n, MethodType t, MethodType a, MethodHandle h, MethodType b) { return null; }
}
J
javac -nowarn -Xlint:-options -source 8 -target 8 -bootclasspath "$T/android.jar" -d "$OUT/stubc" "$OUT/stub/java/lang/invoke/LambdaMetafactory.java"
javac -nowarn -Xlint:-options -source 8 -target 8 -bootclasspath "$T/android.jar" -cp "$LIBS:$OUT/stubc" \
  -d "$OUT/classes" $(find "$A/src" "$OUT/gen" -name '*.java')
java -cp "$T/r8.jar" com.android.tools.r8.D8 --release --min-api 24 \
  --lib "$T/android.jar" --output "$OUT" $(find "$OUT/classes" -name '*.class') "$T"/shizuku-*.jar
(cd "$OUT" && zip -q unsigned.apk classes.dex)

# Signature (clé de debug : suffisant pour installer l'APK à la main)
java -jar "$T/signer.jar" -a "$OUT/unsigned.apk" -o "$OUT/signed" --allowResign >/dev/null
mkdir -p "$ROOT/dist"
cp "$OUT"/signed/*.apk "$ROOT/dist/nettoyeur.apk"
echo "APK : $ROOT/dist/nettoyeur.apk"
