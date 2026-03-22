from __future__ import annotations

from typing import Any

from ..render.base import BaseTheme
from .star_line_minimal import StarLineMinimalTheme
from .star_line_spectrum import StarLineSpectrumTheme
from .techno_minimal import TechnoMinimalTheme
from .wireframe_inbound import WireframeInboundTheme
from .wireframe_pulses import WireframePulsesTheme
from .wireframe_ridge import WireframeRidgeTheme
from .wireframe_wavefront import WireframeWavefrontTheme

THEMES: dict[str, type[BaseTheme]] = {
    "star_line_minimal": StarLineMinimalTheme,
    "star_line_spectrum": StarLineSpectrumTheme,
    "techno_minimal": TechnoMinimalTheme,
    "wireframe_inbound": WireframeInboundTheme,
    "wireframe_pulses": WireframePulsesTheme,
    "wireframe_ridge": WireframeRidgeTheme,
    "wireframe_wavefront": WireframeWavefrontTheme,
}


def create_theme(name: str, width: int, height: int, fps: int, theme_config: dict[str, Any]) -> BaseTheme:
    if name not in THEMES:
        available = ", ".join(sorted(THEMES))
        raise ValueError(f"Unknown theme '{name}'. Available themes: {available}")
    return THEMES[name](width=width, height=height, fps=fps, theme_config=theme_config)
