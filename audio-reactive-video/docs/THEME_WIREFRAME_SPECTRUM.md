# Wireframe Spectrum

## Goal

Create a black-and-white spectrum visualization that emphasizes contour motion rather than solid fill.

The output should read as:

- a thin central axis
- many layered white contour lines
- mirrored above and below the axis
- strong sense of spectral structure without a dominant filled white mass

## Visual Language

- pure black background
- white or slightly warm-white contour lines
- optional subtle glow
- no large solid filled shape
- no particles

## Motion Model

Each contour line is generated from the same underlying stereo spectrum envelope.

- left side uses left channel spectral bands
- right side uses right channel spectral bands
- low frequencies affect broad opening
- mids affect main silhouette
- highs affect local serration

Multiple offset contour copies are drawn:

- inner lines brighter
- outer lines dimmer
- outer lines follow the same shape with additional vertical offset and slight attenuation

## Composition

- the waveform remains horizontally centered
- the main action stays in the lower half if configured so
- contour stack should taper naturally toward both ends

## Brightness

- overall line intensity may rise with RMS / onset / beat
- inner lines can be brighter than outer lines

## Config Surface

- `center_y`
- `spectrum_scale`
- `reveal_span`
- `half_samples`
- `line_count`
- `line_spacing`
- `inner_alpha`
- `outer_alpha`
- `glow_radius`
- `glow_opacity`
