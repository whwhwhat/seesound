from __future__ import annotations

from typing import Any

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

from ..render.base import BaseTheme


class WireframeInboundTheme(BaseTheme):
    def __init__(self, width: int, height: int, fps: int, theme_config: dict[str, Any]) -> None:
        super().__init__(width, height, fps, theme_config)
        self._state = self.initial_state()

    def initial_state(self) -> dict[str, Any]:
        buffer_size = int(self.theme_config.get("buffer_size", 640))
        return {
            "pulse": 0.0,
            "flash": 0.0,
            "left_buffer": np.zeros(buffer_size, dtype=np.float64).tolist(),
            "right_buffer": np.zeros(buffer_size, dtype=np.float64).tolist(),
            "history": [],
        }

    def evolve_state(self, state: dict[str, Any], frame: dict[str, Any]) -> dict[str, Any]:
        buffer_size = len(state["left_buffer"])
        shift = max(1, int(self.theme_config.get("shift_per_frame", 4)))
        injection_width = max(4, int(self.theme_config.get("injection_width", 18)))
        history_decay = float(self.theme_config.get("history_decay", 0.985))

        left_buffer = np.array(state["left_buffer"], dtype=np.float64) * history_decay
        right_buffer = np.array(state["right_buffer"], dtype=np.float64) * history_decay

        left_buffer = np.roll(left_buffer, shift)
        left_buffer[:shift] = 0.0
        right_buffer = np.roll(right_buffer, -shift)
        right_buffer[-shift:] = 0.0

        left_bands = self._resample_bands(
            np.array(frame.get("left_bands", frame["bands"]), dtype=np.float64),
            injection_width,
        )
        right_bands = self._resample_bands(
            np.array(frame.get("right_bands", frame["bands"]), dtype=np.float64),
            injection_width,
        )

        gain = float(self.theme_config.get("edge_injection_gain", 1.0))
        left_buffer[:injection_width] += left_bands * gain
        right_buffer[-injection_width:] += right_bands[::-1] * gain

        bass = float(frame["low_energy"])
        transient = max(float(frame["beat"]), float(frame["onset"]) * 0.8)
        propagated = np.maximum(left_buffer, right_buffer)
        history = [propagated.tolist(), *state.get("history", [])]
        history = history[: int(self.theme_config.get("history_layers", 24))]
        return {
            "pulse": state["pulse"] * 0.9 + bass * 0.1,
            "flash": state["flash"] * 0.74 + transient * 0.26,
            "left_buffer": np.clip(left_buffer, 0.0, 1.5).tolist(),
            "right_buffer": np.clip(right_buffer, 0.0, 1.5).tolist(),
            "history": history,
        }

    def render_frame(
        self,
        frame: dict[str, Any],
        frame_index: int,
        total_frames: int,
        state: dict[str, Any] | None = None,
    ) -> Image.Image:
        if state is None:
            self._state = self.evolve_state(self._state, frame)
            current_state = self._state
        else:
            current_state = state

        image = Image.new("RGBA", (self.width, self.height), (0, 0, 0, 255))
        draw = ImageDraw.Draw(image, "RGBA")

        cy = float(self.theme_config.get("center_y", self.height * 2 / 3))
        line_count = int(self.theme_config.get("line_count", 18))
        inner_alpha = float(self.theme_config.get("inner_alpha", 0.9))
        outer_alpha = float(self.theme_config.get("outer_alpha", 0.16))
        layer_decay = float(self.theme_config.get("outer_amplitude_decay", 0.97))
        pulse_scale = float(self.theme_config.get("pulse_scale", 0.02))
        glow_radius = float(self.theme_config.get("glow_radius", 2.0))
        glow_opacity = float(self.theme_config.get("glow_opacity", 0.07))
        taper_power = float(self.theme_config.get("edge_taper_power", 1.9))
        center_focus = float(self.theme_config.get("center_focus_gain", 0.32))
        history_blend = float(self.theme_config.get("history_blend", 0.72))
        center_peak_power = float(self.theme_config.get("center_peak_power", 2.4))
        stack_spread = float(self.theme_config.get("stack_spread", 120.0))
        stack_power = float(self.theme_config.get("stack_power", 1.65))

        left_buffer = np.array(current_state["left_buffer"], dtype=np.float64)
        right_buffer = np.array(current_state["right_buffer"], dtype=np.float64)
        propagated = np.maximum(left_buffer, right_buffer)
        history = [np.array(item, dtype=np.float64) for item in current_state.get("history", [])]

        x_values = np.linspace(0.0, float(self.width), len(propagated))
        transient = max(float(frame["onset"]), float(frame["beat"]))
        energy = max(float(frame["rms"]), float(frame["mid_energy"]), transient * 0.95)
        pulse = 1.0 + float(current_state["pulse"]) * pulse_scale
        scale = float(self.theme_config.get("spectrum_scale", 52.0)) * pulse

        normalized_x = np.abs((x_values - self.width * 0.5) / max(self.width * 0.5, 1.0))
        taper = np.clip((1.0 - normalized_x) ** taper_power, 0.0, 1.0)
        center_peak = np.clip((1.0 - normalized_x) ** center_peak_power, 0.0, 1.0)
        focus = 1.0 + center_focus * taper + center_peak * center_focus * 1.6
        amp = propagated * scale * taper * focus
        stack_envelope = stack_spread * np.clip((1.0 - normalized_x) ** stack_power, 0.0, 1.0)
        white_level = int(np.clip(208 + energy * 34 + float(current_state["flash"]) * 18, 188, 255))

        for layer in range(line_count):
            ratio = layer / max(1, line_count - 1)
            alpha = int(np.clip((inner_alpha * (1.0 - ratio) + outer_alpha * ratio) * 255, 18, 255))
            level = int(np.clip(white_level - ratio * 20, 165, 255))
            layer_amp = amp * (layer_decay ** layer)

            if layer < len(history):
                historical = history[layer] * scale * taper * focus
                mix = min(1.0, history_blend * (layer / max(1, line_count - 1)))
                layer_amp = (1.0 - mix) * layer_amp + mix * historical

            signed = (ratio - 0.5) * 2.0
            points = []
            for x, base_offset, h in zip(x_values, stack_envelope, layer_amp, strict=True):
                y = cy + signed * base_offset + signed * float(h)
                points.append((float(x), float(y)))

            draw.line(points, fill=(level, level, level, alpha), width=1)

        if glow_radius > 0 and glow_opacity > 0:
            glow = image.filter(ImageFilter.GaussianBlur(radius=glow_radius))
            image = Image.blend(
                image,
                ImageChops.screen(image, glow),
                min(1.0, glow_opacity + float(current_state["flash"]) * 0.04),
            )

        return image.convert("RGB")

    def _resample_bands(self, bands: np.ndarray, target_size: int) -> np.ndarray:
        if len(bands) == target_size:
            return bands
        x_src = np.linspace(0.0, 1.0, len(bands))
        x_dst = np.linspace(0.0, 1.0, target_size)
        return np.interp(x_dst, x_src, bands)
