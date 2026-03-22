from __future__ import annotations

import math
from typing import Any

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

from ..render.base import BaseTheme


class StarLineMinimalTheme(BaseTheme):
    def __init__(self, width: int, height: int, fps: int, theme_config: dict[str, Any]) -> None:
        super().__init__(width, height, fps, theme_config)
        self._state = self.initial_state()

    def initial_state(self) -> dict[str, Any]:
        return {
            "pulse": 0.0,
            "flash": 0.0,
        }

    def evolve_state(self, state: dict[str, Any], frame: dict[str, Any]) -> dict[str, Any]:
        bass = float(frame["low_energy"])
        transient = max(float(frame["beat"]), float(frame["onset"]) * 0.8)
        return {
            "pulse": state["pulse"] * 0.84 + bass * 0.16,
            "flash": state["flash"] * 0.68 + transient * 0.32,
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

        cx = self.width * 0.5
        cy = float(self.theme_config.get("center_y", self.height * 2 / 3))
        size = float(self.theme_config.get("size", 360.0))
        half = size * 0.5
        vertical_scale = float(self.theme_config.get("vertical_scale", 1.0))
        exponent = float(self.theme_config.get("exponent", 2.0 / 3.0))
        pulse_scale = float(self.theme_config.get("pulse_scale", 0.05))
        glow_radius = float(self.theme_config.get("glow_radius", 3.0))
        glow_opacity = float(self.theme_config.get("glow_opacity", 0.12))
        base_line_thickness = int(self.theme_config.get("line_thickness", 2))

        transient = max(float(frame["onset"]), float(frame["beat"]))
        transient_boost = 1.0 + transient * float(self.theme_config.get("transient_boost", 1.8))
        pulse = 1.0 + float(current_state["pulse"]) * pulse_scale

        a = half * pulse
        b = half * vertical_scale * pulse

        left_mid = float(frame.get("left_mid_energy", frame["mid_energy"]))
        right_mid = float(frame.get("right_mid_energy", frame["mid_energy"]))
        left_high = float(frame.get("left_high_energy", frame["high_energy"]))
        right_high = float(frame.get("right_high_energy", frame["high_energy"]))
        left_bands = np.array(frame.get("left_bands", frame["bands"]), dtype=np.float64)
        right_bands = np.array(frame.get("right_bands", frame["bands"]), dtype=np.float64)

        top_points, bottom_points = self._build_full_contours(
            cx=cx,
            cy=cy,
            a=a,
            b=b,
            exponent=exponent,
            left_bands=left_bands,
            right_bands=right_bands,
            left_mid=left_mid,
            right_mid=right_mid,
            left_high=left_high,
            right_high=right_high,
            transient_boost=transient_boost,
        )

        polygon = top_points + list(reversed(bottom_points))
        energy = max(float(frame["rms"]), float(frame["mid_energy"]) * 0.85, transient * 0.9)
        white_level = int(np.clip(210 + energy * 26 + float(current_state["flash"]) * 22, 196, 255))
        outline_level = int(np.clip(white_level + 8, 210, 255))
        baseline_level = int(np.clip(white_level - 4, 188, 255))
        draw.polygon(polygon, fill=(white_level, white_level, white_level, 255))

        baseline_alpha = int(220 + float(current_state["flash"]) * 16)
        draw.line(
            [(0, cy), (self.width, cy)],
            fill=(baseline_level, baseline_level, baseline_level, baseline_alpha),
            width=base_line_thickness,
        )

        outline_alpha = int(238 + float(current_state["flash"]) * 10)
        draw.line(top_points, fill=(outline_level, outline_level, outline_level, outline_alpha), width=1)
        draw.line(bottom_points, fill=(outline_level, outline_level, outline_level, outline_alpha), width=1)

        if glow_radius > 0 and glow_opacity > 0:
            glow = image.filter(ImageFilter.GaussianBlur(radius=glow_radius))
            image = Image.blend(
                image,
                ImageChops.screen(image, glow),
                min(1.0, glow_opacity + float(current_state["flash"]) * 0.08),
            )

        return image.convert("RGB")

    def _build_full_contours(
        self,
        cx: float,
        cy: float,
        a: float,
        b: float,
        exponent: float,
        left_bands: np.ndarray,
        right_bands: np.ndarray,
        left_mid: float,
        right_mid: float,
        left_high: float,
        right_high: float,
        transient_boost: float,
    ) -> tuple[list[tuple[float, float]], list[tuple[float, float]]]:
        sample_step = max(2, int(self.theme_config.get("line_sample_step", 3)))
        x_values = np.arange(0, self.width + sample_step, sample_step, dtype=np.float64)
        if x_values[-1] != self.width:
            x_values = np.append(x_values, self.width)

        top_points: list[tuple[float, float]] = []
        bottom_points: list[tuple[float, float]] = []

        for x in x_values:
            local_x = x - cx
            outside = abs(local_x) >= a
            if outside:
                base_height = 0.0
            else:
                normalized_x = min(1.0, abs(local_x) / max(a, 1e-6))
                base_height = b * (1.0 - normalized_x ** exponent) ** (1.0 / max(exponent, 1e-6))

            side_bands, mid_energy, high_energy = self._select_side_data(
                local_x, left_bands, right_bands, left_mid, right_mid, left_high, right_high
            )
            unified = self._unified_envelope(local_x, a)
            opening, texture = self._dynamic_components(
                local_x=local_x,
                a=a,
                bands=side_bands,
                mid_energy=mid_energy,
                high_energy=high_energy,
                transient_boost=transient_boost,
                unified=unified,
            )

            if outside:
                height = opening + texture
            else:
                inner_weight = self._inner_detail_weight(local_x, a)
                height = base_height + opening * inner_weight + texture * (0.22 + inner_weight * 0.24)

            top_points.append((float(x), cy - height))
            bottom_points.append((float(x), cy + height))

        return top_points, bottom_points

    def _select_side_data(
        self,
        local_x: float,
        left_bands: np.ndarray,
        right_bands: np.ndarray,
        left_mid: float,
        right_mid: float,
        left_high: float,
        right_high: float,
    ) -> tuple[np.ndarray, float, float]:
        if local_x < 0:
            return left_bands, left_mid, left_high
        return right_bands, right_mid, right_high

    def _unified_envelope(self, local_x: float, a: float) -> float:
        abs_x = abs(local_x)
        if abs_x <= a:
            normalized = abs_x / max(a, 1e-6)
            center = 1.0 - normalized
            shoulder = normalized ** 0.85
            return 0.18 + 0.34 * (center ** 0.12) + 0.36 * shoulder

        extension = abs_x - a
        outer_span = max(float(self.theme_config.get("reveal_span", 240.0)), 1.0)
        outer_norm = min(1.0, extension / outer_span)
        return max(0.0, (1.0 - outer_norm) ** 3.8)

    def _inner_detail_weight(self, local_x: float, a: float) -> float:
        normalized = abs(local_x) / max(a, 1e-6)
        center = 1.0 - normalized
        return 0.62 + 0.24 * (center ** 0.14)

    def _dynamic_components(
        self,
        local_x: float,
        a: float,
        bands: np.ndarray,
        mid_energy: float,
        high_energy: float,
        transient_boost: float,
        unified: float,
    ) -> tuple[float, float]:
        abs_x = abs(local_x)
        line_amp = float(self.theme_config.get("line_max_amplitude", 18.0))
        edge_amp = float(self.theme_config.get("edge_max_amplitude", 22.0))
        open_amp = line_amp if abs_x >= a else edge_amp

        spread = float(self.theme_config.get("spike_spread_power", 0.62))
        density = float(self.theme_config.get("spike_density", 78.0))
        micro_density = float(self.theme_config.get("spike_micro_density", 146.0))

        if abs_x >= a:
            outer_span = max(float(self.theme_config.get("reveal_span", 240.0)), 1.0)
            progress = min(1.0, (abs_x - a) / outer_span)
        else:
            progress = abs_x / max(a, 1e-6)

        band_count = max(1, len(bands))
        band_index = min(band_count - 1, int(progress * band_count))
        band_value = float(bands[band_index])

        phase = progress * math.pi
        clustered = abs(math.sin(phase * density)) ** spread
        micro = abs(math.sin(phase * micro_density)) ** 1.6
        texture = 0.7 * clustered + 0.3 * micro

        feature_gain = 0.2 + mid_energy * 1.0 + high_energy * 0.46 + band_value * 0.62
        opening = open_amp * transient_boost * unified * feature_gain

        texture_gain = float(self.theme_config.get("texture_gain", 0.22))
        if abs_x >= a:
            texture_gain *= 0.7
        texture_height = opening * texture_gain * texture
        return opening, texture_height
