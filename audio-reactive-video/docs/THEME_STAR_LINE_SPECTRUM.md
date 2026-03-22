# Star Line Spectrum

## Goal

Render a star-line silhouette where the visible edge motion is driven primarily by real spectral data, not procedural spike textures.

The intent is:

- keep the same black/white four-point star language
- keep the star and horizontal extensions as one continuous silhouette
- make the up/down contour read as compressed spectrum data inside that geometry

## Core Difference From `star_line_minimal`

`star_line_minimal` is a procedural shape driven by audio features.

`star_line_spectrum` should instead behave like:

- a real stereo spectrum envelope
- remapped into a star-shaped container
- still visually restrained and geometric

## Display Model

The full horizontal contour is built from two parts:

1. a static geometric base shape
2. a spectrum displacement field

Final height is the sum of:

- `base_shape_height`
- `spectrum_height`

## Mapping

- left half uses `left_bands`
- right half uses `right_bands`
- stereo bands are resampled to dense horizontal samples
- inside the star region, spectrum is added on top of the inward-curved star silhouette
- outside the star region, the same spectrum continues as the horizontal extension

## Motion Rules

- the contour should respond to actual band structure
- low frequencies create broad thick opening
- mids create main body articulation
- highs create finer serration
- the star and extensions must move as one continuous surface

## Brightness

- overall white brightness may vary with RMS / onset / beat
- higher intensity sections can be brighter
- calmer sections can settle slightly dimmer

## Constraints

- black background only
- white only
- no particles
- no decorative textures unrelated to spectral content
- no visible separation between star body and extension

## Config Surface

- `star.size`
- `star.center_y`
- `star.exponent`
- `spectrum.scale`
- `spectrum.outer_decay`
- `spectrum.sample_count`
- `pulse.scale`
- `brightness.min`
- `brightness.max`
- `glow.radius`
