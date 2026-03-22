# Wireframe Inbound

## Goal

Create a wireframe spectrum theme where spectral energy is injected from the left and right edges and continuously pushed toward the center.

This is not a static mirrored spectrum plot. The key motion model is inward propagation.

## Motion Model

Each frame:

- left spectral envelope is injected at the left edge
- right spectral envelope is injected at the right edge
- left buffer moves rightward
- right buffer moves leftward
- both buffers overlap near the center

The visible waveform is built from propagated buffers, not from the current frame alone.

Contour layers are not parallel offsets.

Each visible line is a scaled or history-mixed version of the same tapered envelope family, so:

- both ends still converge toward points
- the center remains the highest region
- outer lines feel like residual wave history rather than translated copies

## Visual Language

- pure black background
- fine white contour lines
- one thin center axis
- multiple mirrored contour layers
- no filled white mass

## Perceptual Goal

- waves keep arriving from both sides
- the center feels like a convergence zone
- the viewer reads motion first, not area fill

## Config Surface

- `center_y`
- `buffer_size`
- `shift_per_frame`
- `injection_width`
- `line_count`
- `line_spacing`
- `spectrum_scale`
- `history_decay`
- `edge_injection_gain`
- `glow_radius`
