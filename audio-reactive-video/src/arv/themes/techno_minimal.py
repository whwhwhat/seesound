from __future__ import annotations

import math
import random
from typing import Any

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

from ..render.base import BaseTheme


class TechnoMinimalTheme(BaseTheme):
    def __init__(self, width: int, height: int, fps: int, theme_config: dict[str, Any]) -> None:
        super().__init__(width, height, fps, theme_config)
        seed = int(theme_config.get("seed", 42))
        self.random = random.Random(seed)
        palette = theme_config["palette"]
        self.shape_color = tuple(palette["shape"])
        self.accent_color = tuple(palette["accent"])
        self.spark_color = tuple(palette["spark"])
        self._state = self.initial_state()

    def initial_state(self) -> dict[str, Any]:
        return {
            "pulse": 0.0,
            "flash": 0.0,
            "rings": [],
            "particles": [],
        }

    def evolve_state(self, state: dict[str, Any], frame: dict[str, Any]) -> dict[str, Any]:
        bass = float(frame["low_energy"])
        mid = float(frame["mid_energy"])
        treble = float(frame["high_energy"])
        beat = float(frame["beat"])
        next_state = {
            "pulse": state["pulse"] * 0.88 + bass * 0.12,
            "flash": state["flash"] * 0.72 + beat * 0.48,
            "rings": [],
            "particles": [],
        }

        rings = [dict(ring) for ring in state["rings"]]
        particles = [dict(particle) for particle in state["particles"]]

        if beat > float(self.theme_config.get("beat_threshold", 0.46)):
            rings.append(
                {
                    "radius": 56.0,
                    "alpha": 0.68,
                    "thickness": 2.0 + beat * 3.0,
                }
            )
            burst_count = int(self.theme_config["particle_count"] * min(1.0, beat * 0.8))
            for _ in range(burst_count):
                particles.append(
                    {
                        "angle": self.random.uniform(0.0, math.tau),
                        "radius": self.random.uniform(18.0, 36.0),
                        "speed": self.random.uniform(2.0, 6.0) + beat * 2.0,
                        "life": self.random.uniform(0.45, 0.82),
                        "size": self.random.uniform(0.8, 2.0) + treble * 0.8,
                    }
                )

        ring_decay = float(self.theme_config["ring_decay"])
        for ring in rings:
            ring["radius"] += 14.0 + bass * 10.0
            ring["alpha"] *= ring_decay
            ring["thickness"] *= 0.992
            if ring["alpha"] > 0.05:
                next_state["rings"].append(ring)

        particle_drag = float(self.theme_config.get("particle_drag", 0.97))
        for particle in particles:
            particle["radius"] += particle["speed"]
            particle["speed"] *= particle_drag
            particle["life"] *= 0.93
            if particle["life"] > 0.08:
                next_state["particles"].append(particle)

        return next_state

    def render_frame(
        self,
        frame: dict[str, Any],
        frame_index: int,
        total_frames: int,
        state: dict[str, Any] | None = None,
    ) -> Image.Image:
        if state is None:
            self._state = self.evolve_state(self._state, frame)
            state = self._state

        bass = float(frame["low_energy"])
        mid = float(frame["mid_energy"])
        treble = float(frame["high_energy"])
        bands = np.array(frame["bands"], dtype=np.float64)

        base = self.render_background(frame_index, bass, treble, state)
        glow = self.render_main_shape(bands, mid, treble, state)
        texture = self.render_texture(frame_index, bands, mid, treble, state)
        particles = self.render_particles(state)

        composite = Image.alpha_composite(base, glow)
        composite = Image.alpha_composite(composite, texture)
        composite = Image.alpha_composite(composite, particles)
        composite = self.apply_post_fx(composite, treble)
        return composite.convert("RGB")

    def render_background(self, frame_index: int, bass: float, treble: float, state: dict[str, Any]) -> Image.Image:
        image = Image.new("RGBA", (self.width, self.height), (2, 3, 5, 255))
        draw = ImageDraw.Draw(image, "RGBA")
        cx, cy = self.width / 2.0, self.height / 2.0

        gradient_steps = int(self.theme_config.get("background_rings", 3))
        for index in range(gradient_steps):
            amount = index / max(1, gradient_steps - 1)
            radius_x = self.width * (0.22 + amount * 0.56)
            radius_y = self.height * (0.18 + amount * 0.42)
            alpha = int(14 * (1.0 - amount) * (0.7 + state["flash"] * 0.35))
            color = (*self.accent_color, alpha)
            draw.ellipse((cx - radius_x, cy - radius_y, cx + radius_x, cy + radius_y), outline=color, width=1)

        grid_alpha = int(8 + bass * 6)
        grid_step_x = max(120, self.width // int(self.theme_config.get("grid_columns", 12)))
        grid_step_y = max(120, self.height // int(self.theme_config.get("grid_rows", 7)))
        for x in range(0, self.width, grid_step_x):
            draw.line((x, 0, x, self.height), fill=(42, 48, 58, grid_alpha), width=1)
        for y in range(0, self.height, grid_step_y):
            draw.line((0, y, self.width, y), fill=(42, 48, 58, grid_alpha), width=1)

        noise_strength = float(self.theme_config["background_noise"]) * (0.6 + treble)
        if noise_strength > 0:
            noise = self._noise_layer(noise_strength, monochrome=True)
            image = Image.blend(image, noise, min(0.12, noise_strength))
        return image

    def render_main_shape(self, bands: np.ndarray, mid: float, treble: float, state: dict[str, Any]) -> Image.Image:
        layer = Image.new("RGBA", (self.width, self.height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer, "RGBA")
        cx, cy = self.width / 2.0, self.height / 2.0
        min_dim = min(self.width, self.height)
        base_radius = min_dim * float(self.theme_config["base_radius"]) * (0.92 + state["pulse"] * 0.32)

        points: list[tuple[float, float]] = []
        band_count = max(1, len(bands))
        for index, band in enumerate(bands):
            angle = (index / band_count) * math.tau
            wave = math.sin(angle * 2.0 + mid * 4.0) * 0.05
            tremor = math.sin(angle * 10.0 + treble * 8.0) * 0.01
            radius = base_radius * (1.0 + band * 0.18 + mid * 0.08 + wave + tremor)
            x = cx + math.cos(angle) * radius
            y = cy + math.sin(angle) * radius
            points.append((x, y))

        shape_alpha = int(144 + state["flash"] * 30)
        accent_alpha = int(64 + treble * 34)
        outline_width = int(self.theme_config["outline_width"])
        draw.line(points + [points[0]], fill=(*self.shape_color, shape_alpha), width=outline_width)

        inner_points: list[tuple[float, float]] = []
        for x, y in points:
            inner_points.append((cx + (x - cx) * 0.88, cy + (y - cy) * 0.88))
        draw.line(inner_points + [inner_points[0]], fill=(*self.accent_color, accent_alpha), width=1)

        glow = layer.filter(ImageFilter.GaussianBlur(radius=float(self.theme_config["glow_radius"])))
        return ImageChops.screen(glow, layer)

    def render_texture(
        self,
        frame_index: int,
        bands: np.ndarray,
        mid: float,
        treble: float,
        state: dict[str, Any],
    ) -> Image.Image:
        layer = Image.new("RGBA", (self.width, self.height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer, "RGBA")
        cx, cy = self.width / 2.0, self.height / 2.0
        base_radius = min(self.width, self.height) * float(self.theme_config["base_radius"]) * 1.14

        for ring in state["rings"]:
            bbox = (
                cx - ring["radius"],
                cy - ring["radius"],
                cx + ring["radius"],
                cy + ring["radius"],
            )
            draw.ellipse(
                bbox,
                outline=(*self.accent_color, int(255 * ring["alpha"])),
                width=max(1, int(ring["thickness"])),
            )

        spoke_count = int(self.theme_config.get("spoke_count", 18))
        for index in range(spoke_count):
            angle = (index / spoke_count) * math.tau + frame_index * 0.002
            jitter = bands[index % len(bands)] * 28.0 + treble * 8.0
            inner = base_radius * (0.92 + mid * 0.04)
            outer = inner + 8.0 + jitter
            x1 = cx + math.cos(angle) * inner
            y1 = cy + math.sin(angle) * inner
            x2 = cx + math.cos(angle) * outer
            y2 = cy + math.sin(angle) * outer
            alpha = int(14 + treble * 42)
            draw.line((x1, y1, x2, y2), fill=(*self.accent_color, alpha), width=1)

        flicker = self._noise_layer(0.012 + treble * 0.028, monochrome=False)
        flicker.putalpha(int(12 + treble * 24))
        return Image.alpha_composite(layer, flicker)

    def render_particles(self, state: dict[str, Any]) -> Image.Image:
        layer = Image.new("RGBA", (self.width, self.height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer, "RGBA")
        cx, cy = self.width / 2.0, self.height / 2.0

        for particle in state["particles"]:
            x = cx + math.cos(particle["angle"]) * particle["radius"]
            y = cy + math.sin(particle["angle"]) * particle["radius"]
            r = particle["size"]
            alpha = int(255 * particle["life"] * (0.56 + state["flash"] * 0.22))
            draw.ellipse((x - r, y - r, x + r, y + r), fill=(*self.spark_color, alpha))
        return layer

    def apply_post_fx(self, image: Image.Image, treble: float) -> Image.Image:
        blurred = image.filter(ImageFilter.GaussianBlur(radius=float(self.theme_config["blur_radius"])))
        image = Image.blend(image, blurred, 0.05 + treble * 0.04)

        bloom = image.filter(ImageFilter.GaussianBlur(radius=5.0))
        image = Image.blend(image, ImageChops.screen(image, bloom), 0.42)

        image = self._apply_vignette(image)
        image = self._apply_grain(image, strength=float(self.theme_config["grain_strength"]) * (0.8 + treble * 0.5))
        return image

    def _noise_layer(self, strength: float, monochrome: bool) -> Image.Image:
        alpha = max(1, int(255 * min(1.0, strength)))
        if monochrome:
            arr = np.random.randint(0, 40, (self.height, self.width), dtype=np.uint8)
            rgba = np.zeros((self.height, self.width, 4), dtype=np.uint8)
            rgba[:, :, 0] = arr
            rgba[:, :, 1] = arr
            rgba[:, :, 2] = arr
            rgba[:, :, 3] = alpha
        else:
            rgba = np.random.randint(0, 70, (self.height, self.width, 4), dtype=np.uint8)
            rgba[:, :, 3] = alpha
        return Image.fromarray(rgba, mode="RGBA")

    def _apply_vignette(self, image: Image.Image) -> Image.Image:
        x = np.linspace(-1.0, 1.0, self.width)
        y = np.linspace(-1.0, 1.0, self.height)
        xx, yy = np.meshgrid(x, y)
        radius = np.sqrt(xx * xx + yy * yy)
        strength = float(self.theme_config["vignette_strength"])
        vignette = np.clip(1.0 - (radius ** 1.7) * strength, 0.0, 1.0)

        arr = np.array(image).astype(np.float32)
        arr[:, :, :3] *= vignette[:, :, None]
        return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode="RGBA")

    def _apply_grain(self, image: Image.Image, strength: float) -> Image.Image:
        arr = np.array(image).astype(np.float32)
        noise = np.random.normal(0.0, 255.0 * strength, arr[:, :, :3].shape)
        arr[:, :, :3] = np.clip(arr[:, :, :3] + noise, 0.0, 255.0)
        return Image.fromarray(arr.astype(np.uint8), mode="RGBA")
