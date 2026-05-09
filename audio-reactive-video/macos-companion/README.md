# SeeSound Companion

macOS menu bar helper for feeding system audio into the web visualizer without browser tab sharing.

## What It Does

- Runs as a lightweight menu bar app
- Captures macOS system output with `ScreenCaptureKit`
- Exposes control/status endpoints on `http://127.0.0.1:43821`
- Streams PCM audio to the browser over `ws://127.0.0.1:43822`
- Lets the web UI use a new `Desktop App` source mode

## Run It

```bash
cd /Users/anux/repos/seesound/audio-reactive-video/macos-companion
swift run
```

Then in the web app:

1. Start the Vite app as usual.
2. Switch `Source` to `Desktop App`.
3. Click `Start Desktop Audio`.
4. If macOS asks for Screen Recording permission, allow it and retry.

## Notes

- Current implementation captures the active macOS display's system audio path through `ScreenCaptureKit`.
- The bridge is local-only and listens on `127.0.0.1:43821`.
- PCM streaming uses `127.0.0.1:43822`.
- This is macOS-only and currently assumes a single-display default capture target.
- Desktop capture has more latency than file playback because it crosses native capture, local transport, browser ingest, and an AudioWorklet buffer.
