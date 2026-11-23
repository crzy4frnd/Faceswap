# FaceMorph Studio — Pure Native Android App (Kotlin + Jetpack Compose)

This directory is a standalone **100% pure native Android Studio project** written in **Kotlin** and **Jetpack Compose (Material 3)** — with **zero WebView, zero HTML/JavaScript, and zero Capacitor/Cordova**.

## Native Stack
- **Language & UI**: Kotlin `2.0.21` · Jetpack Compose (`androidx.compose:compose-bom:2024.10.01`) · Material 3
- **Camera**: Native CameraX `1.4.1` (`camera-core`, `camera-camera2`, `camera-lifecycle`, `camera-view`, `camera-video`)
- **On-Device AI / Vision**: ML Kit Face Detection (`16.1.7`) & Selfie Segmentation (`16.0.0-beta6`)
- **Target / Min SDK**: `minSdk 24` (Android 7.0+) · `compileSdk 36` · `targetSdk 36`

## Project Layout
- `app/src/main/java/com/facemorph/studio/MainActivity.kt` — Native `ComponentActivity` with `BackHandler` exit confirmation dialog (`Yes`/`No`) and Material 3 navigation
- `app/src/main/java/com/facemorph/studio/viewmodel/StudioViewModel.kt` — Native state management, face profile library, and asynchronous image processing
- `app/src/main/java/com/facemorph/studio/engine/` — On-device Kotlin face swap, skin/lighting calibration shaders, pose matrix smoothing, ML Kit cutout segmentation, cloth physics, and storage helpers
- `app/src/main/java/com/facemorph/studio/ui/` — Compose screens (`FaceStudioScreen`, `LiveCameraScreen`, `BodyPhysicsScreen`, `WardrobeVaultScreen`, `FaceProfileManagerSheet`, `CustomAssetDialog`, `VirtualLightingStudioPanel`)

## Build in Android Studio or CLI
1. Extract this folder and open it directly in **Android Studio** (`Open` -> select this folder containing `build.gradle` & `settings.gradle`).
2. Or build a debug APK from terminal:
   ```bash
   chmod +x gradlew
   ./gradlew assembleDebug --no-daemon
   ```
   Output APK: `app/build/outputs/apk/debug/app-debug.apk`
