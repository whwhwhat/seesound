from __future__ import annotations

from typing import Any

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

from ..render.base import BaseTheme


class WireframePulsesTheme(BaseTheme):
    def __init__(self, width: int, height: int, fps: int, theme_config: dict[str, Any]) -> None:
        super().__init__(width, height, fps, theme_config)
        self._state = self.initial_state()

    def initial_state(self) -> dict[str, Any]:
        sample_count = int(self.theme_config.get("sample_count", 960))
        return {
            "frame_cursor": 0,
            "flash": 0.0,
            "pulses": [],
            "resonances": [],
            "envelope_history": [[0.0] * sample_count],
        }

    def evolve_state(self, state: dict[str, Any], frame: dict[str, Any]) -> dict[str, Any]:
        frame_cursor = int(state.get("frame_cursor", 0)) + 1
        pulses, spawned_resonances = self._advance_pulses(state.get("pulses", []), frame)
        pulses.extend(self._emit_pulses(frame, frame_cursor))
        resonances = self._advance_resonances(state.get("resonances", []), spawned_resonances)
        envelope = self._build_envelope(frame, pulses, resonances)

        history = [envelope.tolist(), *state.get("envelope_history", [])]
        history = history[: int(self.theme_config.get("history_size", 32))]

        transient = max(float(frame["beat"]), float(frame["onset"]))
        return {
            "frame_cursor": frame_cursor,
            "flash": float(state.get("flash", 0.0)) * 0.72 + transient * 0.28,
            "pulses": pulses,
            "resonances": resonances,
            "envelope_history": history,
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
        histories = [np.array(item, dtype=np.float64) for item in current_state.get("envelope_history", [])]
        if not histories:
            histories = [self._build_envelope(frame, [], current_state.get("resonances", []))]

        current_envelope = histories[0]
        line_count = min(int(self.theme_config.get("line_count", 22)), len(histories))
        inner_alpha = float(self.theme_config.get("inner_alpha", 0.84))
        outer_alpha = float(self.theme_config.get("outer_alpha", 0.05))
        history_decay = float(self.theme_config.get("history_decay", 0.975))
        contour_gain = float(self.theme_config.get("contour_gain", 0.92))
        history_span = max(1, int(self.theme_config.get("history_span", 10)))
        contour_lag_mix = float(self.theme_config.get("contour_lag_mix", 0.6))
        contour_shrink = float(self.theme_config.get("contour_shrink", 0.52))
        axis_pull = float(self.theme_config.get("axis_pull", 0.18))
        contour_smooth_base = int(self.theme_config.get("contour_smooth_base", 2))
        contour_smooth_growth = int(self.theme_config.get("contour_smooth_growth", 8))

        transient = max(float(frame["beat"]), float(frame["onset"]))
        energy = max(float(frame["rms"]), float(frame["mid_energy"]), transient)
        white_level = int(np.clip(214 + energy * 28 + float(current_state.get("flash", 0.0)) * 18, 190, 255))

        base_axis_alpha = int(np.clip(float(self.theme_config.get("axis_alpha", 0.2)) * 255, 12, 255))
        draw.line([(0.0, cy), (float(self.width), cy)], fill=(white_level, white_level, white_level, base_axis_alpha), width=1)

        for layer in range(line_count):
            ratio = layer / max(1, line_count - 1)
            alpha = int(np.clip((inner_alpha * (1.0 - ratio) + outer_alpha * ratio) * 255, 14, 255))
            level = int(np.clip(white_level - ratio * 22, 150, 255))
            history_index = min(len(histories) - 1, int(round(ratio * history_span)))
            lagged = histories[history_index] * (history_decay ** history_index)
            envelope = current_envelope * (1.0 - contour_lag_mix * ratio) + lagged * (contour_lag_mix * ratio)
            envelope *= contour_gain * (1.0 - contour_shrink * ratio)
            envelope *= 1.0 - axis_pull * ratio * ratio
            envelope = self._smooth_signal(envelope, contour_smooth_base + int(ratio * contour_smooth_growth))
            top_points = [(float(x), float(cy - h)) for x, h in zip(x_values, envelope, strict=True)]
            bottom_points = [(float(x), float(cy + h)) for x, h in zip(x_values, envelope, strict=True)]
            draw.line(top_points, fill=(level, level, level, alpha), width=1)
            draw.line(bottom_points, fill=(level, level, level, alpha), width=1)

        glow_radius = float(self.theme_config.get("glow_radius", 2.0))
        glow_opacity = float(self.theme_config.get("glow_opacity", 0.08))
        if glow_radius > 0 and glow_opacity > 0:
            glow = image.filter(ImageFilter.GaussianBlur(radius=glow_radius))
            image = Image.blend(
                image,
                ImageChops.screen(image, glow),
                min(1.0, glow_opacity + float(current_state.get("flash", 0.0)) * 0.05),
            )

        return image.convert("RGB")

    def _advance_pulses(self, pulses: list[dict[str, float]], frame: dict[str, Any]) -> tuple[list[dict[str, float]], list[dict[str, float]]]:
        next_pulses: list[dict[str, float]] = []
        spawned_resonances: list[dict[str, float]] = []
        acceleration = 1.0 + float(frame["beat"]) * float(self.theme_config.get("beat_acceleration", 0.5))
        decay = float(self.theme_config.get("pulse_decay", 0.992))
        width_decay = float(self.theme_config.get("width_decay", 0.998))
        center = 0.5
        trail_interval = max(1, int(self.theme_config.get("trail_interval_frames", 2)))
        trail_gain = float(self.theme_config.get("trail_gain", 0.42))
        trail_width_gain = float(self.theme_config.get("trail_width_gain", 0.78))
        center_pull_gain = float(self.theme_config.get("center_pull_gain", 0.22))

        for pulse in pulses:
            side = pulse["side"]
            center_distance = abs(pulse["position"] - center)
            pull = 1.0 + center_pull_gain * (1.0 - min(1.0, center_distance * 2.0))
            velocity = pulse["velocity"] * acceleration * pull
            position = pulse["position"] + velocity if side < 0 else pulse["position"] - velocity
            amplitude = pulse["amplitude"] * decay
            width = pulse["width"] * width_decay
            age = pulse["age"] + 1.0
            center_distance = abs(position - center)
            if center_distance < float(self.theme_config.get("collision_zone", 0.05)):
                amplitude *= float(self.theme_config.get("collision_gain", 1.08))
                width *= float(self.theme_config.get("collision_width_gain", 0.93))
                spawned_resonances.append(
                    self._make_resonance(
                        position=position,
                        amplitude=amplitude * float(self.theme_config.get("collision_resonance_gain", 0.85)),
                        width=width * float(self.theme_config.get("collision_resonance_width_gain", 0.92)),
                        sharpness=pulse["sharpness"] * 0.9,
                    )
                )
            elif int(age) % trail_interval == 0:
                spawned_resonances.append(
                    self._make_resonance(
                        position=position,
                        amplitude=amplitude * trail_gain,
                        width=width * trail_width_gain,
                        sharpness=max(0.8, pulse["sharpness"] * 0.92),
                    )
                )
            if amplitude < 0.01:
                continue
            if side < 0 and position > center + 0.16:
                continue
            if side > 0 and position < center - 0.16:
                continue
            next_pulses.append(
                {
                    "side": side,
                    "position": position,
                    "velocity": pulse["velocity"],
                    "amplitude": amplitude,
                    "width": width,
                    "sharpness": pulse["sharpness"],
                    "age": age,
                }
            )
        max_active = int(self.theme_config.get("max_active_pulses", 28))
        next_pulses.sort(
            key=lambda pulse: (
                abs(pulse["position"] - center) * 0.7 - pulse["amplitude"] * 0.3,
                -pulse["age"],
            )
        )
        return next_pulses[:max_active], spawned_resonances

    def _advance_resonances(
        self,
        resonances: list[dict[str, float]],
        spawned_resonances: list[dict[str, float]],
    ) -> list[dict[str, float]]:
        next_resonances: list[dict[str, float]] = []
        decay = float(self.theme_config.get("resonance_decay", 0.974))
        width_growth = float(self.theme_config.get("resonance_width_growth", 1.002))

        for resonance in resonances:
            amplitude = resonance["amplitude"] * decay
            if amplitude < 0.008:
                continue
            next_resonances.append(
                {
                    "position": resonance["position"],
                    "amplitude": amplitude,
                    "width": resonance["width"] * width_growth,
                    "sharpness": resonance["sharpness"],
                    "age": resonance["age"] + 1.0,
                }
            )

        next_resonances.extend(spawned_resonances)
        center = 0.5
        max_active = int(self.theme_config.get("max_active_resonances", 64))
        next_resonances.sort(
            key=lambda item: (
                abs(item["position"] - center) * 0.75 - item["amplitude"] * 0.25,
                -item["age"],
            )
        )
        return next_resonances[:max_active]

    def _emit_pulses(self, frame: dict[str, Any], frame_cursor: int) -> list[dict[str, float]]:
        pulses: list[dict[str, float]] = []
        beat = float(frame["beat"])
        onset = float(frame["onset"])
        bass = float(frame["low_energy"])
        mid = float(frame["mid_energy"])
        high = float(frame["high_energy"])
        left_low = float(frame.get("left_low_energy", bass))
        right_low = float(frame.get("right_low_energy", bass))
        left_mid = float(frame.get("left_mid_energy", mid))
        right_mid = float(frame.get("right_mid_energy", mid))
        left_high = float(frame.get("left_high_energy", high))
        right_high = float(frame.get("right_high_energy", high))
        left_centroid = float(frame.get("left_centroid", frame.get("centroid", 0.0)))
        right_centroid = float(frame.get("right_centroid", frame.get("centroid", 0.0)))
        left_rms = float(frame.get("left_rms", frame["rms"]))
        right_rms = float(frame.get("right_rms", frame["rms"]))
        left_bands = np.array(frame.get("left_bands", frame["bands"]), dtype=np.float64)
        right_bands = np.array(frame.get("right_bands", frame["bands"]), dtype=np.float64)
        left_low_band, left_mid_band, left_high_band = self._band_zone_energies(left_bands)
        right_low_band, right_mid_band, right_high_band = self._band_zone_energies(right_bands)

        transient = max(beat, onset)
        base_interval = max(2, int(self.theme_config.get("emit_interval_frames", 4)))
        should_emit = transient > float(self.theme_config.get("transient_emit_threshold", 0.2)) or frame_cursor % base_interval == 0
        if not should_emit:
            return pulses

        base_velocity = float(self.theme_config.get("base_velocity", 0.024))
        velocity = base_velocity * (1.0 + bass * 0.35 + transient * 0.72)
        base_width = float(self.theme_config.get("base_width", 0.012))
        width = max(0.004, base_width * (0.82 + bass * 0.28 - high * 0.08))
        sharpness = float(self.theme_config.get("sharpness", 2.2)) + high * 0.28
        amp_base = float(self.theme_config.get("base_amplitude", 0.9))
        amp_boost = 1.0 + transient * 1.2 + bass * 0.45 + mid * 0.26
        edge_pad = float(self.theme_config.get("edge_pad", 0.018))
        centroid_gain = float(self.theme_config.get("centroid_velocity_gain", 0.22))

        pulses.extend(
            self._emit_side_pulses(
                side=-1.0,
                edge_position=edge_pad,
                velocity=velocity,
                width=width,
                sharpness=sharpness,
                amp_base=amp_base,
                amp_boost=amp_boost,
                rms=left_rms,
                low=left_low,
                mid=left_mid,
                high=left_high,
                low_band=left_low_band,
                mid_band=left_mid_band,
                high_band=left_high_band,
                centroid=left_centroid,
                transient=transient,
                centroid_gain=centroid_gain,
            )
        )
        pulses.extend(
            self._emit_side_pulses(
                side=1.0,
                edge_position=1.0 - edge_pad,
                velocity=velocity,
                width=width,
                sharpness=sharpness,
                amp_base=amp_base,
                amp_boost=amp_boost,
                rms=right_rms,
                low=right_low,
                mid=right_mid,
                high=right_high,
                low_band=right_low_band,
                mid_band=right_mid_band,
                high_band=right_high_band,
                centroid=right_centroid,
                transient=transient,
                centroid_gain=centroid_gain,
            )
        )

        if transient > float(self.theme_config.get("secondary_emit_threshold", 0.28)):
            second_velocity = velocity * 1.18
            second_width = width * 0.78
            second_amp = amp_base * (0.7 + transient * 1.1 + high * 0.4)
            pulses.append(self._make_pulse(side=-1.0, position=edge_pad * 1.5, velocity=second_velocity, amplitude=second_amp, width=second_width, sharpness=sharpness + 0.25))
            pulses.append(self._make_pulse(side=1.0, position=1.0 - edge_pad * 1.5, velocity=second_velocity, amplitude=second_amp, width=second_width, sharpness=sharpness + 0.25))

        return pulses

    def _build_envelope(self, frame: dict[str, Any], pulses: list[dict[str, float]], resonances: list[dict[str, float]]) -> np.ndarray:
        sample_count = int(self.theme_config.get("sample_count", 960))
        x = np.linspace(0.0, 1.0, sample_count)
        envelope = np.zeros(sample_count, dtype=np.float64)

        for pulse in pulses:
            d = np.abs(x - pulse["position"]) / max(1e-6, pulse["width"])
            shape = np.exp(-(d**2) * pulse["sharpness"])
            envelope += pulse["amplitude"] * shape

        for resonance in resonances:
            d = np.abs(x - resonance["position"]) / max(1e-6, resonance["width"])
            shape = np.exp(-(d**2) * resonance["sharpness"])
            envelope += resonance["amplitude"] * shape

        # A narrow center focus makes collisions read taller without turning the
        # whole image into one wide center blob.
        center_focus = np.exp(-((x - 0.5) ** 2) / max(1e-6, float(self.theme_config.get("center_focus_width", 0.0022))))
        envelope += center_focus * float(self.theme_config.get("center_focus_gain", 0.12)) * max(float(frame["low_energy"]), float(frame["beat"]))

        spectral_mod = self._build_spectral_modulator(frame, sample_count)
        envelope *= spectral_mod

        # Short-range ripple preserves the urgent techno feel.
        ripple_freq = float(self.theme_config.get("ripple_frequency", 20.0)) + float(frame.get("centroid", 0.0)) * 4.0
        ripple_gain = float(self.theme_config.get("ripple_gain", 0.08))
        ripple = 1.0 + ripple_gain * np.sin(np.linspace(0.0, ripple_freq * np.pi, sample_count)) * (0.35 + float(frame["high_energy"]) * 0.65)
        envelope *= ripple

        taper = np.sin(np.linspace(0.0, np.pi, sample_count)) ** float(self.theme_config.get("edge_taper_power", 0.75))
        envelope *= taper
        envelope = self._smooth_signal(envelope, int(self.theme_config.get("envelope_smooth_radius", 2)))
        center_clamp = np.exp(-((x - 0.5) ** 2) / max(1e-6, float(self.theme_config.get("center_clamp_width", 0.0016))))
        clamp_gain = float(self.theme_config.get("center_clamp_gain", 0.32))
        envelope *= 1.0 / (1.0 + center_clamp * clamp_gain * envelope)
        amplitude_scale = float(self.theme_config.get("amplitude_scale", 72.0))
        return np.clip(envelope * amplitude_scale, 0.0, None)

    def _emit_side_pulses(
        self,
        *,
        side: float,
        edge_position: float,
        velocity: float,
        width: float,
        sharpness: float,
        amp_base: float,
        amp_boost: float,
        rms: float,
        low: float,
        mid: float,
        high: float,
        low_band: float,
        mid_band: float,
        high_band: float,
        centroid: float,
        transient: float,
        centroid_gain: float,
    ) -> list[dict[str, float]]:
        pulses: list[dict[str, float]] = []
        direction = 1.0 if side < 0 else -1.0

        bass_amp = amp_base * amp_boost * (0.52 + rms * 0.42 + low * 0.9 + low_band * 0.75)
        bass_velocity = velocity * (0.92 + low * 0.16 + low_band * 0.12)
        bass_width = width * (1.15 + low * 0.2)
        pulses.append(
            self._make_pulse(
                side=side,
                position=edge_position,
                velocity=bass_velocity,
                amplitude=bass_amp,
                width=bass_width,
                sharpness=max(0.9, sharpness * 0.82),
            )
        )

        mid_amp = amp_base * (0.34 + mid * 0.72 + mid_band * 0.82 + transient * 0.22)
        mid_velocity = velocity * (1.02 + mid * 0.26 + centroid * centroid_gain * 0.5)
        mid_width = width * (0.84 + mid * 0.1)
        pulses.append(
            self._make_pulse(
                side=side,
                position=np.clip(edge_position + direction * width * 1.3, 0.0, 1.0),
                velocity=mid_velocity,
                amplitude=mid_amp,
                width=mid_width,
                sharpness=sharpness * (1.0 + mid * 0.08),
            )
        )

        if high > 0.08 or high_band > 0.08 or transient > 0.2:
            high_amp = amp_base * (0.18 + high * 0.56 + high_band * 0.72 + transient * 0.18)
            high_velocity = velocity * (1.18 + high * 0.32 + centroid * centroid_gain)
            high_width = max(0.0035, width * (0.55 - high * 0.08))
            pulses.append(
                self._make_pulse(
                    side=side,
                    position=np.clip(edge_position + direction * width * 2.3, 0.0, 1.0),
                    velocity=high_velocity,
                    amplitude=high_amp,
                    width=high_width,
                    sharpness=sharpness * (1.28 + high * 0.18),
                )
            )

        return pulses

    def _build_spectral_modulator(self, frame: dict[str, Any], sample_count: int) -> np.ndarray:
        left_bands = np.array(frame.get("left_bands", frame["bands"]), dtype=np.float64)
        right_bands = np.array(frame.get("right_bands", frame["bands"]), dtype=np.float64)
        half_count = sample_count // 2

        left_profile = self._resample_bands(left_bands, half_count)
        right_profile = self._resample_bands(right_bands, sample_count - half_count)
        left_delta = self._band_delta_profile(left_profile)
        right_delta = self._band_delta_profile(right_profile)

        left_profile = left_profile * 0.72 + left_delta * 0.5
        right_profile = right_profile * 0.72 + right_delta * 0.5
        profile = np.concatenate([left_profile, right_profile[::-1]])
        profile = self._smooth_signal(profile, int(self.theme_config.get("spectral_mod_smooth_radius", 4)))

        high = float(frame["high_energy"])
        mid = float(frame["mid_energy"])
        depth = float(self.theme_config.get("spectral_mod_depth", 0.38))
        gain = depth * (0.42 + mid * 0.42 + high * 0.6)
        return np.clip(0.8 + profile * gain, 0.65, 1.55)

    def _resample_bands(self, bands: np.ndarray, target_size: int) -> np.ndarray:
        if len(bands) == target_size:
            return bands
        x_src = np.linspace(0.0, 1.0, len(bands))
        x_dst = np.linspace(0.0, 1.0, target_size)
        return np.interp(x_dst, x_src, bands)

    def _band_zone_energies(self, bands: np.ndarray) -> tuple[float, float, float]:
        if bands.size == 0:
            return 0.0, 0.0, 0.0
        third = max(1, bands.size // 3)
        low = float(np.mean(bands[:third]))
        mid = float(np.mean(bands[third : third * 2])) if bands.size > third else low
        high = float(np.mean(bands[third * 2 :])) if bands.size > third * 2 else mid
        return low, mid, high

    def _band_delta_profile(self, profile: np.ndarray) -> np.ndarray:
        if profile.size <= 1:
            return np.zeros_like(profile)
        delta = np.abs(np.gradient(profile))
        max_value = float(np.max(delta))
        if max_value <= 1e-9:
            return np.zeros_like(profile)
        return delta / max_value

    def _make_pulse(
        self,
        *,
        side: float,
        position: float,
        velocity: float,
        amplitude: float,
        width: float,
        sharpness: float,
    ) -> dict[str, float]:
        return {
            "side": side,
            "position": position,
            "velocity": velocity,
            "amplitude": amplitude,
            "width": width,
            "sharpness": sharpness,
            "age": 0.0,
        }

    def _make_resonance(
        self,
        *,
        position: float,
        amplitude: float,
        width: float,
        sharpness: float,
    ) -> dict[str, float]:
        return {
            "position": position,
            "amplitude": amplitude,
            "width": width,
            "sharpness": sharpness,
            "age": 0.0,
        }

    def _smooth_signal(self, values: np.ndarray, radius: int) -> np.ndarray:
        if radius <= 1:
            return values
        kernel_x = np.arange(-radius, radius + 1, dtype=np.float64)
        sigma = max(radius / 2.2, 1.0)
        kernel = np.exp(-(kernel_x**2) / (2.0 * sigma * sigma))
        kernel /= np.sum(kernel)
        return np.convolve(values, kernel, mode="same")
