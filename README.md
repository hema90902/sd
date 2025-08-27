# P2P Group Chat (Android + WebRTC)

This repo contains:
- Signaling server: `/workspace/signaling-server` (Node.js WebSocket)
- Android app: `/workspace/android-app` (Compose + WebRTC DataChannels, full-mesh)

## Prerequisites
- Node.js 18+
- Android Studio (Koala+), SDK 34, JDK 17

## Run signaling server
```bash
node /workspace/signaling-server/server.js
```
Listens on `ws://0.0.0.0:8080`.

## Android app
1. Open `android-app` in Android Studio.
2. Ensure the app points to your signaling server:
   - Emulator: keep `ws://10.0.2.2:8080` (default in `SignalingClient.DEFAULT_URL`).
   - Physical device: change to host IP, e.g. `ws://192.168.1.10:8080`.
3. Run on 2+ devices/emulators, enter same Room ID, and chat.

## Notes
- Uses STUN: Google + Twilio (UDP) in `RtcMesh.kt`.
- Full-mesh works best for small groups (<=6). For larger rooms, consider SFU or server fanout.
