WEARHOUSE — ANDROID / PWA PACKAGE

PWA
Serve this folder over HTTPS or localhost. Open index.html and use your browser's Install App / Add to Home Screen command. The included manifest and service worker provide standalone launch and offline shell caching.

ANDROID APK (Windows PowerShell)
Requirements: Node.js 22 or newer, Android Studio, and the Android SDK configured.

From this folder, run:

npm install; if ($LASTEXITCODE -eq 0 -and !(Test-Path android)) { npx cap add android }; if ($LASTEXITCODE -eq 0) { npx cap sync android }; if ($LASTEXITCODE -eq 0) { Push-Location android; .\gradlew.bat assembleDebug; Pop-Location }

APK output: android\app\build\outputs\apk\debug\app-debug.apk

The native project packages the single-file SPA in www/index.html. User data and accounts remain local to the browser/WebView installation. The local password reset is not email-verified account recovery.
