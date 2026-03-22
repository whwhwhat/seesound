from __future__ import annotations

from typing import Any

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

from ..render.base import BaseTheme


class WireframeWavefrontTheme(BaseTheme):
    def __init__(self, width: int, height: int, fps: int, theme_config: dict[str, Any]) -> None:
        super().__init__(width, height, fps, theme_config)
        self._state = self.initial_state()

    def initial_state(self) -> dict[str, Any]:
        sample_count = int(self.theme_config.get("sample_count", 960))
        half_count = max(2, sample_count // 2)
        stream_stride = max(1, int(self.theme_config.get("stream_stride", 3)))
        reconstruction_window = max(8, int(self.theme_config.get("reconstruction_window", 32)))
        stream_size = half_count * stream_stride + reconstruction_window * 4
        return {
            "left_stream": np.zeros(stream_size, dtype=np.float64).tolist(),
            "right_stream": np.zeros(stream_size, dtype=np.float64).tolist(),
            "signal_history": [np.zeros(sample_count, dtype=np.float64).tolist()],
            "flash": 0.0,
        }

    def evolve_state(self, state: dict[str, Any], frame: dict[str, Any]) -> dict[str, Any]:
        left_stream = np.array(state.get("left_stream", []), dtype=np.float64)
        right_stream = np.array(state.get("right_stream", []), dtype=np.float64)
        if left_stream.size == 0 or right_stream.size == 0:
            sample_count = int(self.theme_config.get("sample_count", 960))
            half_count = max(2, sample_count // 2)
            stream_stride = max(1, int(self.theme_config.get("stream_stride", 3)))
            reconstruction_window = max(8, int(self.theme_config.get("reconstruction_window", 32)))
            stream_size = half_count * stream_stride + reconstruction_window * 4
            left_stream = np.zeros(stream_size, dtype=np.float64)
            right_stream = np.zeros(stream_size, dtype=np.float64)

        left_stream, right_stream = self._advance_streams(left_stream, right_stream, frame)
        signal = self._reconstruct_signal(left_stream, right_stream)
        history = [signal.tolist(), *state.get("signal_history", [])]
        history = history[: int(self.theme_config.get("history_size", 18))]

        wave_energy = max(
            float(np.mean(np.abs(frame.get("left_waveform", [0.0])))),
            float(np.mean(np.abs(frame.get("right_waveform", [0.0])))),
        )
        return {
            "left_stream": left_stream.tolist(),
            "right_stream": right_stream.tolist(),
            "signal_history": history,
            "flash": float(state.get("flash", 0.0)) * 0.82 + wave_energy * 0.18,
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
        sample_count = int(self.theme_config.get("sample_count", 960))
        x_values = np.linspace(0.0, float(self.width), sample_count)
        histories = [np.array(item, dtype=np.float64) for item in current_state.get("signal_history", [])]
        if not histories:
            histories = [np.zeros(sample_count, dtype=np.float64)]

        line_count = min(int(self.theme_config.get("line_count", 16)), len(histories))
        inner_alpha = float(self.theme_config.get("inner_alpha", 0.84))
        outer_alpha = float(self.theme_config.get("outer_alpha", 0.08))
        history_decay = float(self.theme_config.get("history_decay", 0.965))
        history_span = max(1, int(self.theme_config.get("history_span", 12)))
        lag_mix = float(self.theme_config.get("history_lag_mix", 0.72))
        contour_shrink = float(self.theme_config.get("contour_shrink", 0.24))
        axis_pull = float(self.theme_config.get("axis_pull", 0.12))
        amplitude_scale = float(self.theme_config.get("amplitude_scale", 220.0))
        wave_gamma = float(self.theme_config.get("wave_gamma", 0.84))

        base_axis_alpha = int(np.clip(float(self.theme_config.get("axis_alpha", 0.18)) * 255, 8, 255))
        draw.line([(0.0, cy), (float(self.width), cy)], fill=(220, 220, 220, base_axis_alpha), width=1)

        for layer in range(line_count):
            ratio = layer / max(1, line_count - 1)
            history_index = min(len(histories) - 1, int(round(ratio * history_span)))
            lagged = histories[history_index] * (history_decay ** history_index)
            signal = histories[0] * (1.0 - lag_mix * ratio) + lagged * (lag_mix * ratio)
            signal = self._shape_signal(signal, wave_gamma)
            signal *= 1.0 - contour_shrink * ratio
            signal *= 1.0 - axis_pull * ratio * ratio
            signal = self._smooth_signal(signal, max(1, int(self.theme_config.get("smooth_radius", 2)) + layer // 4))

            alpha = int(np.clip((inner_alpha * (1.0 - ratio) + outer_alpha * ratio) * 255, 10, 255))
            level = int(np.clip(244 - ratio * 32, 148, 255))
            scaled = signal * amplitude_scale
            top_points = [(float(x), float(cy - y)) for x, y in zip(x_values, scaled, strict=True)]
            bottom_points = [(float(x), float(cy + y)) for x, y in zip(x_values, scaled, strict=True)]
            draw.line(top_points, fill=(level, level, level, alpha), width=1)
            draw.line(bottom_points, fill=(level, level, level, alpha), width=1)

        glow_radius = float(self.theme_config.get("glow_radius", 2.0))
        glow_opacity = float(self.theme_config.get("glow_opacity", 0.06))
        if glow_radius > 0 and glow_opacity > 0:
            glow = image.filter(ImageFilter.GaussianBlur(radius=glow_radius))
            image = Image.blend(
                image,
                ImageChops.screen(image, glow),
                min(1.0, glow_opacity + float(current_state.get("flash", 0.0)) * 0.04),
            )

        return image.convert("RGB")

    def _advance_streams(
        self,
        left_stream: np.ndarray,
        right_stream: np.ndarray,
        frame: dict[str, Any],
    ) -> tuple[np.ndarray, np.ndarray]:
        decay = float(self.theme_config.get("stream_decay", self.theme_config.get("buffer_decay", 0.999)))
        injection_samples = max(8, int(self.theme_config.get("injection_samples", 80)))
        injection_mix = float(self.theme_config.get("injection_mix", 0.92))
        left_wave = self._prepare_waveform(frame.get("left_waveform", []), injection_samples)
        right_wave = self._prepare_waveform(frame.get("right_waveform", []), injection_samples)

        left_stream = np.concatenate([left_wave, left_stream[: max(0, left_stream.size - left_wave.size)]]) * decay
        right_stream = np.concatenate([right_wave, right_stream[: max(0, right_stream.size - right_wave.size)]]) * decay
        left_stream[: left_wave.size] = left_stream[: left_wave.size] * (1.0 - injection_mix) + left_wave * injection_mix
        right_stream[: right_wave.size] = right_stream[: right_wave.size] * (1.0 - injection_mix) + right_wave * injection_mix
        return left_stream, right_stream

    def _prepare_waveform(self, waveform: list[float] | np.ndarray, target_size: int) -> np.ndarray:
        values = np.array(waveform, dtype=np.float64)
        if values.size == 0:
            return np.zeros(target_size, dtype=np.float64)
        values = self._resample_signal(values, target_size)
        values = self._smooth_signal(values, max(1, int(self.theme_config.get("injection_smooth_radius", 2))))
        return np.clip(values, -1.0, 1.0)

    def _reconstruct_signal(self, left_stream: np.ndarray, right_stream: np.ndarray) -> np.ndarray:
        sample_count = int(self.theme_config.get("sample_count", 960))
        half_count = max(2, sample_count // 2)
        left_profile = self._reconstruct_side(left_stream, half_count)
        right_profile = self._reconstruct_side(right_stream, sample_count - half_count)
        return np.concatenate([left_profile, right_profile[::-1]])

    def _reconstruct_side(self, stream: np.ndarray, target_size: int) -> np.ndarray:
        stride = max(1, int(self.theme_config.get("stream_stride", 3)))
        window = max(8, int(self.theme_config.get("reconstruction_window", 32)))
        peak_gain = float(self.theme_config.get("reconstruction_peak_gain", 0.44))
        rms_gain = float(self.theme_config.get("reconstruction_rms_gain", 0.22))
        carrier_gain = float(self.theme_config.get("reconstruction_carrier_gain", 0.72))
        derivative_gain = float(self.theme_config.get("reconstruction_derivative_gain", 0.28))

        values = np.zeros(target_size, dtype=np.float64)
        for index in range(target_size):
            start = min(stream.size - 1, index * stride)
            end = min(stream.size, start + window)
            segment = stream[start:end]
            if segment.size == 0:
                continue

            center_idx = min(segment.size - 1, max(0, segment.size // 2))
            carrier = float(segment[center_idx])
            peak = float(np.max(np.abs(segment)))
            rms = float(np.sqrt(np.mean(segment * segment)))
            derivative = float(np.mean(np.abs(np.diff(segment)))) if segment.size > 1 else 0.0
            sign = 1.0 if carrier >= 0 else -1.0

            value = (
                carrier * carrier_gain
                + sign * peak * peak_gain
                + sign * rms * rms_gain
                + sign * derivative * derivative_gain
            )
            values[index] = value

        spread = np.linspace(1.0, 0.74, target_size)
        values *= spread
        return self._smooth_signal(values, max(1, int(self.theme_config.get("reconstruction_smooth_radius", 3))))

    def _shape_signal(self, values: np.ndarray, gamma: float) -> np.ndarray:
        magnitude = np.power(np.abs(values), gamma)
        return np.sign(values) * magnitude

    def _resample_signal(self, values: np.ndarray, target_size: int) -> np.ndarray:
        if values.size == 0:
            return np.zeros(target_size, dtype=np.float64)
        if values.size == target_size:
            return values.astype(np.float64, copy=True)
        x_src = np.linspace(0.0, 1.0, values.size)
        x_dst = np.linspace(0.0, 1.0, target_size)
        return np.interp(x_dst, x_src, values)

    def _smooth_signal(self, values: np.ndarray, radius: int) -> np.ndarray:
        if radius <= 1:
            return values
        kernel_x = np.arange(-radius, radius + 1, dtype=np.float64)
        sigma = max(radius / 2.2, 1.0)
        kernel = np.exp(-(kernel_x**2) / (2.0 * sigma * sigma))
        kernel /= np.sum(kernel)
        return np.convolve(values, kernel, mode="same")
