# Architecture

## Pipeline

1. `analysis.py`
   - load audio
   - extract frame-wise features
   - smooth features
   - write `analysis.json`
2. `render/pipeline.py`
   - read `analysis.json`
   - create theme instance
   - render sequential PNG frames
3. `export.py`
   - call analysis
   - call frame renderer
   - call `ffmpeg` to mux frames with original audio

## Frame Data

Each frame contains:

- `time`
- `rms`
- `low_energy`
- `mid_energy`
- `high_energy`
- `centroid`
- `onset`
- `beat`
- `bands`

## Theme Contract

Themes subclass `BaseTheme` and implement layered drawing:

- `render_background`
- `render_main_shape`
- `render_texture`
- `render_particles`
- `apply_post_fx`

The current MVP theme is `techno_minimal`.

## Future Theme Expansion

Suggested next themes:

- `fluid`
- `geometry`
- `brutalist_wire`

The CLI and pipeline already resolve themes by name, so adding new files under `themes/` is enough.
