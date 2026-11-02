#!/bin/bash
# Build the Tokisla phone-test APK (WebView shell + bundled web app).
# Re-run after changing the web app or the demo videos; output: ../tokisla.apk
set -e
cd "$(dirname "$0")"
TOOLS="$HOME/workspace/tools"
SDK="$TOOLS/android-sdk"
BT="$SDK/build-tools/34.0.0"
export JAVA_HOME="$TOOLS/jdk17"
export PATH="$JAVA_HOME/bin:$PATH"

# Refresh the bundled web app from the Tokisla source package
rm -rf assets/www && mkdir -p assets/www
cp -r ../tokisla-app/index.html ../tokisla-app/styles.css ../tokisla-app/config.js \
      ../tokisla-app/store.js ../tokisla-app/app.js ../tokisla-app/manifest.webmanifest \
      ../tokisla-app/sw.js assets/www/
mkdir -p assets/www/assets
cp -r ../tokisla-app/assets/branding ../tokisla-app/assets/demo ../tokisla-app/assets/user assets/www/assets/

rm -rf build && mkdir -p build/classes build/dex
"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/unsigned.apk -I "$SDK/platforms/android-34/android.jar" \
  --manifest AndroidManifest.xml -A assets build/res.zip --auto-add-overlay
javac -source 11 -target 11 -cp "$SDK/platforms/android-34/android.jar" -d build/classes \
  src/com/chairmanwadood/tokisla/MainActivity.java
(cd build/classes && jar cf ../classes.jar .)
"$BT/d8" --release --output build/dex build/classes.jar
(cd build/dex && zip -q ../unsigned.apk classes.dex)
"$BT/zipalign" -f 4 build/unsigned.apk build/aligned.apk
"$BT/apksigner" sign --ks "$HOME/.local/share/godot/keystores/debug.keystore" \
  --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android \
  --out "$HOME/workspace/tokisla.apk" build/aligned.apk
echo "BUILT: $HOME/workspace/tokisla.apk"
