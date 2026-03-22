from __future__ import annotations

from typing import Any

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

from ..render.base import BaseTheme


class WireframeRidgeTheme(BaseTheme):
    def __init__(self, width: int, height: int, fps: int, theme_config: dict[str, Any]) -> None:
        super().__init__(width, height, fps, theme_config)
        self._state = self.initial_state()

    def initial_state(self) -> dict[str, Any]:
        sample_count = int(self.theme_config.get("sample_count", 960))
        half_count = sample_count // 2
        return {
            "pulse": 0.0,
            "flash": 0.0,
            "ridge_history": [],
            "left_flow": np.zeros(half_count, dtype=np.float64).tolist(),
            "right_flow": np.zeros(half_count, dtype=np.float64).tolist(),
        }

    def evolve_state(self, state: dict[str, Any], frame: dict[str, Any]) -> dict[str, Any]:
        bass = float(frame["low_energy"])
        transient = max(float(frame["beat"]), float(frame["onset"]) * 0.8)
        left_flow, right_flow = self._advance_flows(state, frame)
        ridge = self._build_ridge(frame, left_flow, right_flow)
        history = [ridge.tolist(), *state.get("ridge_history", [])]
        history = history[: int(self.theme_config.get("history_size", 28))]
        return {
            "pulse": state["pulse"] * 0.9 + bass * 0.1,
            "flash": state["flash"] * 0.76 + transient * 0.24,
            "ridge_history": history,
            "left_flow": left_flow.tolist(),
            "right_flow": right_flow.tolist(),
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
        x_values = np.linspace(0.0, float(self.width), int(self.theme_config.get("sample_count", 960)))
        ridge_history = [np.array(item, dtype=np.float64) for item in current_state.get("ridge_history", [])]

        line_count = int(self.theme_config.get("line_count", 28))
        inner_alpha = float(self.theme_config.get("inner_alpha", 0.94))
        outer_alpha = float(self.theme_config.get("outer_alpha", 0.12))
        ridge_decay = float(self.theme_config.get("ridge_decay", 0.96))
        history_blend = float(self.theme_config.get("history_blend", 0.68))
        field_spread = float(self.theme_config.get("field_spread", 0.96))
        line_jitter = float(self.theme_config.get("line_jitter", 0.04))
        center_line_alpha = float(self.theme_config.get("center_line_alpha", 0.3))
        if ridge_history:
            ridge = ridge_history[0]
        else:
            left_flow, right_flow = self._advance_flows(current_state, frame)
            ridge = self._build_ridge(frame, left_flow, right_flow)

        # Render a family of topographic contour lines through one shared thickness field.
        # This avoids reading as two separate upper/lower surfaces.
        offsets = np.linspace(-1.0, 1.0, line_count)
        center_index = max(0, line_count // 2)

        transient = max(float(frame["onset"]), float(frame["beat"]))
        energy = max(float(frame["rms"]), float(frame["mid_energy"]), transient * 0.92)
        white_level = int(np.clip(206 + energy * 36 + float(current_state["flash"]) * 16, 188, 255))

        for layer, offset in enumerate(offsets):
            distance = abs(offset)
            ratio = distance
            history_slot = min(len(ridge_history) - 1, int(round(distance * (len(ridge_history) - 1)))) if ridge_history else 0
            history_ridge = ridge_history[history_slot] * (ridge_decay ** history_slot) if ridge_history else ridge
            mixed_ridge = ridge * (1.0 - history_blend * ratio) + history_ridge * (history_blend * ratio)

            alpha = int(np.clip((inner_alpha * (1.0 - ratio) + outer_alpha * ratio) * 255, 20, 255))
            level = int(np.clip(white_level - ratio * 14, 176, 255))

            points = []
            for idx, (x, h) in enumerate(zip(x_values, mixed_ridge, strict=True)):
                aperture = h * field_spread
                jitter = np.sin(idx * 0.08 + layer * 0.55) * h * line_jitter * (0.12 + ratio * 0.88)
                y = cy + offset * aperture + jitter
                points.append((float(x), float(y)))

            if layer == center_index:
                alpha = int(alpha * center_line_alpha)
                level = min(255, level + 10)
            draw.line(points, fill=(level, level, level, alpha), width=1)

        glow_radius = float(self.theme_config.get("glow_radius", 2.0))
        glow_opacity = float(self.theme_config.get("glow_opacity", 0.06))
        if glow_radius > 0 and glow_opacity > 0:
            glow = image.filter(ImageFilter.GaussianBlur(radius=glow_radius))
            image = Image.blend(
                image,
                ImageChops.screen(image, glow),
                min(1.0, glow_opacity + float(current_state["flash"]) * 0.04),
            )

        return image.convert("RGB")

    def _build_ridge(self, frame: dict[str, Any], left_flow: np.ndarray, right_flow: np.ndarray) -> np.ndarray:
        sample_count = int(self.theme_config.get("sample_count", 960))
        x = np.linspace(-1.0, 1.0, sample_count)
        abs_x = np.abs(x)
        spectrum = np.concatenate([left_flow, right_flow])

        taper_power = float(self.theme_config.get("taper_power", 3.2))
        center_emphasis = float(self.theme_config.get("center_emphasis", 1.55))
        taper = np.clip((1.0 - abs_x) ** taper_power, 0.0, 1.0)
        center = np.clip((1.0 - abs_x) ** center_emphasis, 0.0, 1.0)

        mid = float(frame["mid_energy"])
        high = float(frame["high_energy"])
        bass = float(frame["low_energy"])
        transient = max(float(frame["onset"]), float(frame["beat"]))

        scale = float(self.theme_config.get("ridge_scale", 360.0))
        spine = 0.01 + center * (0.03 + bass * 0.05)
        spectrum_weight = 0.18 + 1.2 * center
        ridge = scale * taper * (spine + spectrum * spectrum_weight)

        # Derivative detail carries visible ridges, but the ridge itself is smoothed
        # to avoid reading as a polyline.
        derivative = np.abs(np.gradient(spectrum))
        ridge += scale * 0.72 * taper * derivative * (0.4 + high * 1.3 + transient * 0.65)

        # Add center focus, but keep enough side energy so the motion reads
        # as wavefronts traveling inward rather than a static center blob.
        center_peak = np.exp(-(x ** 2) / max(1e-6, float(self.theme_config.get("center_peak_width", 0.028))))
        ridge += scale * float(self.theme_config.get("center_peak_gain", 0.04)) * center_peak * (0.12 + bass * 0.18 + transient * 0.12)
        ridge = self._smooth_signal(ridge, int(self.theme_config.get("ridge_smooth_radius", 3)))
        return np.clip(ridge, 0.0, None)

    def _advance_flows(self, state: dict[str, Any], frame: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
        sample_count = int(self.theme_config.get("sample_count", 960))
        half_count = sample_count // 2
        shift = max(1, int(self.theme_config.get("propagation_shift", 8)))
        injection_width = max(1, int(self.theme_config.get("injection_width", 6)))
        decay = float(self.theme_config.get("flow_decay", 0.997))

        prev_left = np.array(state.get("left_flow", [0.0] * half_count), dtype=np.float64)
        prev_right = np.array(state.get("right_flow", [0.0] * half_count), dtype=np.float64)

        left_flow = np.roll(prev_left * decay, shift)
        right_flow = np.roll(prev_right * decay, -shift)

        left_bands = self._resample_bands(np.array(frame.get("left_bands", frame["bands"]), dtype=np.float64), half_count)
        right_bands = self._resample_bands(np.array(frame.get("right_bands", frame["bands"]), dtype=np.float64), half_count)
        left_bands = self._smooth_signal(np.clip(left_bands, 0.0, None), int(self.theme_config.get("band_smooth_radius", 2)))
        right_bands = self._smooth_signal(np.clip(right_bands, 0.0, None), int(self.theme_config.get("band_smooth_radius", 2)))

        transient = max(float(frame["beat"]), float(frame["onset"]))
        high = max(float(frame["high_energy"]), 0.0)
        edge_gain = float(self.theme_config.get("edge_injection_gain", 2.4)) * (1.0 + transient * 1.6 + high * 0.75)
        edge_shape = np.linspace(1.0, 0.25, injection_width, dtype=np.float64) ** float(
            self.theme_config.get("edge_injection_power", 1.8)
        )

        left_injection = left_bands[:injection_width] * edge_shape * edge_gain
        right_injection = right_bands[-injection_width:] * edge_shape[::-1] * edge_gain
        left_flow[:injection_width] = np.maximum(left_flow[:injection_width], left_injection)
        right_flow[-injection_width:] = np.maximum(right_flow[-injection_width:], right_injection)

        left_flow = self._smooth_signal(left_flow, int(self.theme_config.get("flow_smooth_radius", 3)))
        right_flow = self._smooth_signal(right_flow, int(self.theme_config.get("flow_smooth_radius", 3)))
        return left_flow, right_flow

    def _resample_bands(self, bands: np.ndarray, target_size: int) -> np.ndarray:
        if len(bands) == target_size:
            return bands
        x_src = np.linspace(0.0, 1.0, len(bands))
        x_dst = np.linspace(0.0, 1.0, target_size)
        return np.interp(x_dst, x_src, bands)

    def _smooth_signal(self, values: np.ndarray, radius: int) -> np.ndarray:
        if radius <= 1:
            return values
        kernel_x = np.arange(-radius, radius + 1, dtype=np.float64)
        sigma = max(radius / 2.2, 1.0)
        kernel = np.exp(-(kernel_x ** 2) / (2.0 * sigma * sigma))
        kernel /= np.sum(kernel)
        return np.convolve(values, kernel, mode="same")
