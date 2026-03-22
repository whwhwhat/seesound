from __future__ import annotations

from typing import Any

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

from ..render.base import BaseTheme


class StarLineSpectrumTheme(BaseTheme):
    def __init__(self, width: int, height: int, fps: int, theme_config: dict[str, Any]) -> None:
        super().__init__(width, height, fps, theme_config)
        self._state = self.initial_state()

    def initial_state(self) -> dict[str, Any]:
        return {"pulse": 0.0, "flash": 0.0}

    def evolve_state(self, state: dict[str, Any], frame: dict[str, Any]) -> dict[str, Any]:
        bass = float(frame["low_energy"])
        transient = max(float(frame["beat"]), float(frame["onset"]) * 0.8)
        return {
            "pulse": state["pulse"] * 0.86 + bass * 0.14,
            "flash": state["flash"] * 0.72 + transient * 0.28,
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
        size = float(self.theme_config.get("size", 340.0))
        half = size * 0.5
        exponent = float(self.theme_config.get("exponent", 0.54))
        vertical_scale = float(self.theme_config.get("vertical_scale", 1.0))
        pulse_scale = float(self.theme_config.get("pulse_scale", 0.02))
        glow_radius = float(self.theme_config.get("glow_radius", 2.5))
        glow_opacity = float(self.theme_config.get("glow_opacity", 0.1))
        line_thickness = int(self.theme_config.get("line_thickness", 2))

        transient = max(float(frame["onset"]), float(frame["beat"]))
        pulse = 1.0 + float(current_state["pulse"]) * pulse_scale
        a = half * pulse
        b = half * vertical_scale * pulse

        half_samples = int(self.theme_config.get("half_samples", 320))
        left_bands = self._resample_bands(np.array(frame.get("left_bands", frame["bands"]), dtype=np.float64), half_samples)
        right_bands = self._resample_bands(np.array(frame.get("right_bands", frame["bands"]), dtype=np.float64), half_samples)

        top_points, bottom_points = self._build_contours(
            cx=cx,
            cy=cy,
            a=a,
            b=b,
            exponent=exponent,
            left_bands=left_bands,
            right_bands=right_bands,
            frame=frame,
            transient=transient,
        )

        polygon = top_points + list(reversed(bottom_points))
        energy = max(float(frame["rms"]), float(frame["mid_energy"]), transient * 0.92)
        white_level = int(
            np.clip(
                float(self.theme_config.get("brightness_min", 206.0))
                + energy * float(self.theme_config.get("brightness_range", 42.0))
                + float(current_state["flash"]) * 18.0,
                185,
                255,
            )
        )
        baseline_level = int(np.clip(white_level - 6, 180, 255))
        outline_level = int(np.clip(white_level + 6, 205, 255))

        draw.polygon(polygon, fill=(white_level, white_level, white_level, 255))
        draw.line([(0, cy), (self.width, cy)], fill=(baseline_level, baseline_level, baseline_level, 224), width=line_thickness)
        draw.line(top_points, fill=(outline_level, outline_level, outline_level, 238), width=1)
        draw.line(bottom_points, fill=(outline_level, outline_level, outline_level, 238), width=1)

        if glow_radius > 0 and glow_opacity > 0:
            glow = image.filter(ImageFilter.GaussianBlur(radius=glow_radius))
            image = Image.blend(
                image,
                ImageChops.screen(image, glow),
                min(1.0, glow_opacity + float(current_state["flash"]) * 0.08),
            )

        return image.convert("RGB")

    def _resample_bands(self, bands: np.ndarray, target_size: int) -> np.ndarray:
        if len(bands) == target_size:
            return bands
        x_src = np.linspace(0.0, 1.0, len(bands))
        x_dst = np.linspace(0.0, 1.0, target_size)
        return np.interp(x_dst, x_src, bands)

    def _build_contours(
        self,
        cx: float,
        cy: float,
        a: float,
        b: float,
        exponent: float,
        left_bands: np.ndarray,
        right_bands: np.ndarray,
        frame: dict[str, Any],
        transient: float,
    ) -> tuple[list[tuple[float, float]], list[tuple[float, float]]]:
        step = max(2, int(self.theme_config.get("line_sample_step", 2)))
        x_values = np.arange(0, self.width + step, step, dtype=np.float64)
        if x_values[-1] != self.width:
            x_values = np.append(x_values, self.width)

        spectrum_scale = float(self.theme_config.get("spectrum_scale", 30.0))
        outer_decay = float(self.theme_config.get("outer_decay_power", 4.2))
        inner_mix = float(self.theme_config.get("inner_spectrum_mix", 0.82))
        extension_mix = float(self.theme_config.get("extension_spectrum_mix", 0.92))
        reveal_span = max(float(self.theme_config.get("reveal_span", 210.0)), 1.0)
        transient_boost = 1.0 + transient * float(self.theme_config.get("transient_boost", 1.6))
        mid = float(frame["mid_energy"])
        high = float(frame["high_energy"])
        bass = float(frame["low_energy"])

        top_points: list[tuple[float, float]] = []
        bottom_points: list[tuple[float, float]] = []

        for x in x_values:
            local_x = x - cx
            abs_x = abs(local_x)
            outside = abs_x >= a
            side_bands = left_bands if local_x < 0 else right_bands

            if outside:
                extension = abs_x - a
                outer_norm = min(1.0, extension / reveal_span)
                band_pos = outer_norm
                base_height = 0.0
                envelope = max(0.0, (1.0 - outer_norm) ** outer_decay)
                mix = extension_mix
            else:
                inner_norm = abs_x / max(a, 1e-6)
                band_pos = inner_norm
                base_height = b * (1.0 - inner_norm ** exponent) ** (1.0 / max(exponent, 1e-6))
                center = 1.0 - inner_norm
                shoulder = inner_norm ** 0.82
                envelope = 0.22 + 0.26 * (center ** 0.12) + 0.52 * shoulder
                mix = inner_mix

            band_value = self._sample_band(side_bands, band_pos)
            local_average = self._local_band_average(side_bands, band_pos)
            spectrum_height = spectrum_scale * transient_boost * envelope * mix * (
                0.16 + band_value * 0.9 + local_average * 0.6 + mid * 0.4 + high * 0.2 + bass * 0.15
            )

            serration = spectrum_height * 0.16 * self._band_delta(side_bands, band_pos)
            height = base_height + spectrum_height + serration
            top_points.append((float(x), cy - height))
            bottom_points.append((float(x), cy + height))

        return top_points, bottom_points

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
        lo = max(0, idx - 2)
        hi = min(len(bands), idx + 3)
        return float(np.mean(bands[lo:hi]))

    def _band_delta(self, bands: np.ndarray, position: float) -> float:
        position = float(np.clip(position, 0.0, 1.0))
        idx = int(round(position * (len(bands) - 1)))
        lo = max(0, idx - 1)
        hi = min(len(bands) - 1, idx + 1)
        if hi == lo:
            return 0.0
        return float(np.clip(abs(float(bands[hi]) - float(bands[lo])) * 1.4, 0.0, 1.0))
