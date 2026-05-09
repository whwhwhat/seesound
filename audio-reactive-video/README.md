# Audio Reactive Video

This folder contains the current SeeSound app.

## Parts

- [`web/`](./web): the Vite + TypeScript browser app.
- [`macos-companion/`](./macos-companion): optional macOS menu bar companion for system audio capture.
- [`docs/`](./docs): implementation and deployment notes.

## Web App

```bash
cd /Users/anux/repos/seesound/audio-reactive-video/web
npm install
npm run dev
```

Useful commands:

```bash
npm run check
npm run build
npm run preview
```

`npm run check` validates shader files and runs TypeScript checking.

## Audio Sources

`File` is the lowest-latency and most reliable path. It keeps playback, analysis, and rendering inside the browser page.

`Browser Tab` uses browser screen/tab sharing. Choose a tab and enable audio sharing when prompted.

`Desktop App` uses the macOS companion. It is useful when you need system output, but it has more latency than file playback because audio moves through native capture, local transport, browser ingest, and an AudioWorklet buffer.

## Visual Modes

- `Spectral`: the main resonant field renderer, with WebGPU preferred and legacy fallback support.
- `Crystal`: a dedicated WebGPU harmonic membrane renderer.
- `Lattice`: a dedicated WebGPU projected spatial wireframe renderer.

When WebGPU is unavailable, the dedicated `Crystal` and `Lattice` renderers may not display; `Spectral` has the broader fallback path.

## Hidden / Deferred Features

The video export UI is currently disabled. The implementation files remain in place so the feature can be repaired later without rediscovering the whole recording path.
