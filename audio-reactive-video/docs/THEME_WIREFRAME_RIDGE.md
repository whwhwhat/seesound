# Wireframe Ridge

## Goal

Create a wireframe spectrum visualization based on one evolving center waveform ridge and a stack of contour lines sampled through one shared thickness field.

This avoids reading as two separated upper/lower surfaces or a hollow envelope.

## Core Model

1. inject stereo spectral energy from the left and right edges
2. move those edge flows horizontally toward the center over time
3. generate one main waveform ridge from the propagated flow
4. keep recent ridge histories
5. use that ridge as a thickness field
6. draw many contour lines through the same field instead of drawing two surfaces

The visual result should feel like:

- one coherent waveform family
- many contour echoes
- stronger center structure
- tapered ends
- no obvious split into upper and lower halves

## Motion

- current ridge is driven by stereo spectral data
- left and right energy are injected at the edges and pushed inward
- recent ridges remain visible as dimmer contour copies
- history creates the layered look
- propagation feeling comes from actual horizontal flow plus history accumulation

## Constraints

- black background
- white contour lines only
- no solid fill
- no clear split into two independent surfaces
- no large hollow center shape
- no hard polyline corners
