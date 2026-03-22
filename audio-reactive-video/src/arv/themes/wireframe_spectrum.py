from __future__ import annotations

from typing import Any

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

from ..render.base import BaseTheme


class WireframeSpectrumTheme(BaseTheme):
    def __init__(self, width: int, height: int, fps: int, theme_config: dict[str, Any]) -> None:
        super().__init__(width, height, fps, theme_config)
        self._state = self.initial_state()

    def initial_state(self) -> dict[str, Any]:
        return {"pulse": 0.0, "flash": 0.0}

    def evolve_state(self, state: dict[str, Any], frame: dict[str, Any]) -> dict[str, Any]:
        bass = float(frame["low_energy"])
        transient = max(float(frame["beat"]), float(frame["onset"]) * 0.8)
        return {
            "pulse": state["pulse"] * 0.88 + bass * 0.12,
            "flash": state["flash"] * 0.74 + transient * 0.26,
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
        step = max(2, int(self.theme_config.get("line_sample_step", 2)))
        x_values = np.arange(0, self.width + step, step, dtype=np.float64)
        if x_values[-1] != self.width:
            x_values = np.append(x_values, self.width)

        half_samples = int(self.theme_config.get("half_samples", 420))
        left_bands = self._resample_bands(np.array(frame.get("left_bands", frame["bands"]), dtype=np.float64), half_samples)
        right_bands = self._resample_bands(np.array(frame.get("right_bands", frame["bands"]), dtype=np.float64), half_samples)

        transient = max(float(frame["onset"]), float(frame["beat"]))
        pulse = 1.0 + float(current_state["pulse"]) * float(self.theme_config.get("pulse_scale", 0.015))
        spectrum_scale = float(self.theme_config.get("spectrum_scale", 34.0)) * pulse
        reveal_span = max(float(self.theme_config.get("reveal_span", self.width * 0.5)), 1.0)
        outer_decay = float(self.theme_config.get("outer_decay_power", 2.6))

        amplitude = self._build_amplitude(
            x_values=x_values,
            left_bands=left_bands,
            right_bands=right_bands,
            frame=frame,
            transient=transient,
            scale=spectrum_scale,
            reveal_span=reveal_span,
            outer_decay=outer_decay,
        )

        energy = max(float(frame["rms"]), float(frame["mid_energy"]), transient * 0.95)
        white_level = int(np.clip(205 + energy * 34 + float(current_state["flash"]) * 18, 188, 255))
        base_axis_level = int(np.clip(white_level - 12, 168, 240))
        draw.line([(0, cy), (self.width, cy)], fill=(base_axis_level, base_axis_level, base_axis_level, 180), width=1)

        line_count = int(self.theme_config.get("line_count", 18))
        line_spacing = float(self.theme_config.get("line_spacing", 7.0))
        inner_alpha = float(self.theme_config.get("inner_alpha", 0.92))
        outer_alpha = float(self.theme_config.get("outer_alpha", 0.2))
        taper = float(self.theme_config.get("outer_amplitude_decay", 0.92))

        for line_index in range(line_count):
            layer_ratio = line_index / max(1, line_count - 1)
            vertical_offset = line_index * line_spacing
            alpha = int(np.clip((inner_alpha * (1.0 - layer_ratio) + outer_alpha * layer_ratio) * 255, 24, 255))
            level = int(np.clip(white_level - layer_ratio * 18, 170, 255))
            band_scale = taper ** line_index

            top_points = []
            bottom_points = []
            for x, height in zip(x_values, amplitude, strict=True):
                y_offset = vertical_offset + height * band_scale
                top_points.append((float(x), cy - y_offset))
                bottom_points.append((float(x), cy + y_offset))

            draw.line(top_points, fill=(level, level, level, alpha), width=1)
            draw.line(bottom_points, fill=(level, level, level, alpha), width=1)

        glow_radius = float(self.theme_config.get("glow_radius", 2.0))
        glow_opacity = float(self.theme_config.get("glow_opacity", 0.08))
        if glow_radius > 0 and glow_opacity > 0:
            glow = image.filter(ImageFilter.GaussianBlur(radius=glow_radius))
            image = Image.blend(
                image,
                ImageChops.screen(image, glow),
                min(1.0, glow_opacity + float(current_state["flash"]) * 0.05),
            )

        return image.convert("RGB")

    def _build_amplitude(
        self,
        x_values: np.ndarray,
        left_bands: np.ndarray,
        right_bands: np.ndarray,
        frame: dict[str, Any],
        transient: float,
        scale: float,
        reveal_span: float,
        outer_decay: float,
    ) -> np.ndarray:
        cx = self.width * 0.5
        mid = float(frame["mid_energy"])
        high = float(frame["high_energy"])
        bass = float(frame["low_energy"])
        transient_boost = 1.0 + transient * float(self.theme_config.get("transient_boost", 1.4))

        amplitude = np.zeros_like(x_values, dtype=np.float64)
        for i, x in enumerate(x_values):
            local_x = x - cx
            abs_x = abs(local_x)
            side_bands = left_bands if local_x < 0 else right_bands

            norm = min(1.0, abs_x / reveal_span)
            envelope = max(0.0, (1.0 - norm) ** outer_decay)
            band_value = self._sample_band(side_bands, norm)
            local_average = self._local_band_average(side_bands, norm)
            delta = self._band_delta(side_bands, norm)
            amplitude[i] = scale * transient_boost * envelope * (
                0.12 + band_value * 1.05 + local_average * 0.7 + delta * 0.28 + mid * 0.26 + high * 0.12 + bass * 0.1
            )
        return amplitude

    def _resample_bands(self, bands: np.ndarray, target_size: int) -> np.ndarray:
        if len(bands) == target_size:
            return bands
        x_src = np.linspace(0.0, 1.0, len(bands))
        x_dst = np.linspace(0.0, 1.0, target_size)
        return np.interp(x_dst, x_src, bands)

    def _sample_band(self, bands: np.ndarray, position: float) -> float:
        position = float(np.clip(position, 0.0, 1.0))
        if len(bands) == 1:
            return float(bands[0])
        idx = position * (len(bands) - 1)
        lo = int(np.floor(idx))
        hi = min(len(bands) - 1, lo + 1)
        t = idx - lo
        return float((1.0 - t) * bands[lo] + t * bands[hi])

    def _local_band_average(self, bands: np.ndarray, position: float) -> float:
        position = float(np.clip(position, 0.0, 1.0))
        idx = int(round(position * (len(bands) - 1)))
        lo = max(0, idx - 3)
        hi = min(len(bands), idx + 4)
        return float(np.mean(bands[lo:hi]))

    def _band_delta(self, bands: np.ndarray, position: float) -> float:
        position = float(np.clip(position, 0.0, 1.0))
        idx = int(round(position * (len(bands) - 1)))
        lo = max(0, idx - 1)
        hi = min(len(bands) - 1, idx + 1)
        if hi == lo:
            return 0.0
        return float(np.clip(abs(float(bands[hi]) - float(bands[lo])) * 1.5, 0.0, 1.0))
