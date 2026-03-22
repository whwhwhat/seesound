# Wireframe Pulses

## Goal

Create a black/white wireframe spectrum theme that reads as many discrete pulses being emitted from the left and right edges, moving toward the center, and stacking into brighter contour echoes.

## Core Model

1. emit discrete stereo pulses from the left and right edges
2. move those pulses inward every frame
3. convert the active pulse set into one mirrored amplitude envelope
4. keep recent envelope histories
5. draw many thin mirrored contour lines from those histories

## Motion

- pulses are not a continuous flow field
- left and right sides emit separately
- beat and onset create stronger, faster pulses
- old contours remain as dimmer echoes
- the center grows because incoming pulses overlap there, not because of a large fixed center blob

## Constraints

- black background
- white contour lines only
- no solid fill
- visible local peaks along the horizontal axis
- strong sense of bilateral inward motion
