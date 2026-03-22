from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

from PIL import Image


class BaseTheme(ABC):
    def __init__(self, width: int, height: int, fps: int, theme_config: dict[str, Any]) -> None:
        self.width = width
        self.height = height
        self.fps = fps
        self.theme_config = theme_config

    @abstractmethod
    def initial_state(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def evolve_state(self, state: dict[str, Any], frame: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def render_frame(
        self,
        frame: dict[str, Any],
        frame_index: int,
        total_frames: int,
        state: dict[str, Any] | None = None,
    ) -> Image.Image:
        raise NotImplementedError

    def before_render(self, output_dir: Path) -> None:
        output_dir.mkdir(parents=True, exist_ok=True)
