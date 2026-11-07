#!/bin/sh
# Generate the native iOS/Android projects (they are not committed) and apply the development
# settings Meridian needs. Safe to re-run.
#   ./tool/setup_platforms.sh && flutter run --dart-define=MERIDIAN_API=http://localhost:8080
set -eu
cd "$(dirname "$0")/.."
flutter create --project-name meridian_mobile --platforms ios,android . >/dev/null
rm -rf test   # the template's widget test is not part of this project
# iOS: allow plain-http requests to local development servers only (ATS stays on for the internet).
PLIST=ios/Runner/Info.plist
if ! /usr/libexec/PlistBuddy -c 'Print :NSAppTransportSecurity:NSAllowsLocalNetworking' "$PLIST" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c 'Add :NSAppTransportSecurity dict' "$PLIST"
  /usr/libexec/PlistBuddy -c 'Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true' "$PLIST"
fi
flutter pub get
echo "Platforms ready. Android cleartext to the emulator host (10.0.2.2) needs android:usesCleartextTraffic in debug only."
