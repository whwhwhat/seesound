# Star Line Minimal

## Goal

Create a restrained audio-reactive visual theme built from one geometric symbol:

- pure black background
- one white four-point star
- one thin horizontal line extending from the star to both screen edges

This theme is intended to feel minimal, clean, graphic, and precise.

## Canvas

- resolution: `1920x1080`
- background: `#000000`

## Layout

- star center x: `960`
- star center y: `720`
- star size: about `360x360`
- star top tip should sit near the frame horizontal center line
- left and right star tips connect to thin horizontal lines that reach the screen edges

## Static Shape

The base star is a smooth four-cusp shape, visually close to an astroid:

- top, bottom, left, right tips remain sharp
- the four connecting edges remain smooth
- the left and right tips blend naturally into the horizontal line

The static frame should read as:

- black field
- one white symbol
- one continuous thin white horizontal axis
- the star and the line should feel like one continuous silhouette, not separate layers

## Motion Rules

Only a few motions are allowed.

### 1. Left and Right Line Motion

- left line responds to left channel
- right line responds to right channel
- the baseline itself stays perfectly horizontal
- motion appears as thin vertical spikes growing out from the line
- strongest motion happens near the star
- motion should decay quickly after leaving the star shoulders, not stay active all the way to the screen edges
- motion amplitude stays small and controlled

Suggested mapping:

- low frequencies: slow broad undulation
- mid frequencies: main visible waveform
- high frequencies: fine edge chatter only

### 2. Star Body Motion

- the star identity must remain stable
- left and right edges stay mostly stable
- top and bottom edges inherit waveform-like modulation
- modulation should look like a very thin spectral disturbance carved into the edge
- overall body may pulse slightly with bass

### 3. Beat / Onset

Beat should not create particles, shockwaves, or decorative effects.

Allowed reactions:

- brief white intensity lift
- slight outline thickening
- very light halo increase for a few frames
- overall white brightness may rise with musical intensity and settle back down during calmer sections

## Audio Features Needed

This theme requires stereo-aware analysis.

Per frame:

- `left_rms`
- `right_rms`
- `left_low_energy`
- `right_low_energy`
- `left_mid_energy`
- `right_mid_energy`
- `left_high_energy`
- `right_high_energy`
- `left_bands`
- `right_bands`

Global mono features are still useful:

- `rms`
- `low_energy`
- `mid_energy`
- `high_energy`
- `onset`
- `beat`

## Mapping Plan

- left line amplitude: `left_mid_energy` with small `left_high_energy` detail
- right line amplitude: `right_mid_energy` with small `right_high_energy` detail
- upper edge modulation: mostly left-biased stereo blend
- lower edge modulation: mostly right-biased stereo blend
- global size pulse: `low_energy`
- brightness flash: `beat` and `onset`

## Style Constraints

Avoid:

- particles
- noise textures
- colorful accents
- aggressive bloom
- full-screen grain
- traditional bar-spectrum visuals

Keep:

- black background
- white-only drawing
- clean geometry
- very limited glow
- high contrast

## Config Surface

Recommended exposed parameters:

- `star.size`
- `star.center_y`
- `star.exponent`
- `line.thickness`
- `line.max_amplitude`
- `line.decay_power`
- `edge.max_amplitude`
- `edge.detail_gain`
- `pulse.scale`
- `flash.strength`
- `glow.radius`

## Implementation Notes

Suggested layer split:

1. background
2. horizontal line system
3. star fill
4. edge modulation
5. minimal post-fx

This theme should be faster than the techno theme because it avoids heavy full-frame texture work and particle systems.
