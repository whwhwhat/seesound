# Web Performance Optimization Plan

## Goal

Optimize the Web realtime preview for the highest-impact rendering path while preserving the tuned visual look as much as possible.

The current priority order is:

1. Preserve the current look of `glow` mode.
2. Improve the hot path used for live tuning.
3. Keep `isoline`, `residual`, and `percentile` working, even if they stay on a slower fallback path initially.

## Current Bottlenecks

The dominant costs are currently:

1. GPU to CPU readback via `gl.readPixels(...)`
2. CPU full-frame shading of the scalar field
3. CPU isoline extraction via marching squares
4. Multi-pass glow contour blur/compositing on the 2D canvas

The largest architectural issue is that the render path does GPU field accumulation first, then returns to CPU for the rest of the frame. That structure limits the benefit of WebGL.

## Strategy

Split the renderer into:

1. A GPU-first hot path for the main tuning workflow
2. A compatibility path for the more experimental or CPU-dependent modes

This keeps visual risk low while targeting the highest payoff work first.

## Phase 1

### Scope

Target only the main hot path:

- `renderStyle === "glow"`
- `displayMode === "single"` or `combineMode === "signed"`

### Changes

1. Route the hot path through GPU final shading.
2. Avoid reading back GPU color accumulation and color weight textures on that path.
3. Avoid CPU per-pixel field shading on that path.
4. Keep CPU isoline extraction and contour overlay for now, so the final line structure stays close to the current tuned look.

### Expected Benefit

- Reduce GPU readback from 3 attachments to 1 attachment on the hot path.
- Remove one large CPU full-frame shading loop from the hot path.
- Preserve the current contour geometry because isoline extraction remains CPU-based for now.

### Visual Risk

Low to medium.

The base field shading will come from the GPU shader, but the contour overlay still comes from the current CPU isoline pipeline. This should keep the overall shape language close to the current result.

### Acceptance Criteria

1. `glow + signed/single` renders correctly.
2. Visual output remains close to the current tuned appearance.
3. CPU full-frame shading is skipped on the hot path.
4. Only field readback remains on the hot path.

## Phase 2

### Scope

Continue optimizing `glow` mode.

### Changes

1. Move more of the glow contour look into the GPU path.
2. Reduce or eliminate the need for per-frame CPU isoline extraction in `glow`.
3. Keep `isoline` mode on the precise CPU path.

### Expected Benefit

This is the phase that can remove the final per-frame GPU readback from the main hot path.

### Visual Risk

Medium.

This phase touches the exact contour glow construction and must be compared against the current tuned look.

## Phase 3

### Scope

Optimize slower fallback modes without changing the main rendering architecture.

### Changes

1. Replace full sort in `percentile` with an approximate quantile method.
2. Reuse scratch buffers in radial residual processing.
3. Add dynamic glow buffer resolution.

### Expected Benefit

Reduce cost of experimental modes and improve performance on lower-end devices.

## Phase 4

### Scope

Adaptive quality control.

### Changes

1. Track rolling frame time.
2. Adjust glow buffer resolution and other non-structural quality knobs automatically.
3. Only reduce `fieldSize` as a last resort.

### Expected Benefit

More stable framerate across devices while preserving visual quality on stronger hardware.

## Non-Goals For Phase 1

Phase 1 does not attempt to:

1. Rewrite `isoline` mode
2. Reimplement `residual` or `percentile` on the GPU
3. Change the modal synthesis logic
4. Retune the overall visual design
