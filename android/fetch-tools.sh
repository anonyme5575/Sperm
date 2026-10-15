#!/usr/bin/env bash
# Downloads the minimal Android toolchain into android/.tools (no Android SDK install needed):
#   android.jar (API 34), aapt2 (from apktool), d8 (r8lib), uber-apk-signer (zipalign + signing).
set -euo pipefail
T="$(cd "$(dirname "$0")" && pwd)/.tools"
mkdir -p "$T"
get() { [ -s "$T/$1" ] || curl -fsSL --retry 3 -o "$T/$1" "$2"; }
get android.jar    https://raw.githubusercontent.com/Sable/android-platforms/master/android-34/android.jar
get apktool.jar    https://github.com/iBotPeaches/Apktool/releases/download/v2.10.0/apktool_2.10.0.jar
get r8.jar         https://storage.googleapis.com/r8-releases/raw/8.5.35/r8lib.jar
get signer.jar     https://github.com/patrickfav/uber-apk-signer/releases/download/v1.3.0/uber-apk-signer-1.3.0.jar
if [ ! -x "$T/aapt2" ]; then
  unzip -p "$T/apktool.jar" prebuilt/linux/aapt2_64 > "$T/aapt2"
  chmod +x "$T/aapt2"
fi
echo "Outils prêts dans $T"
