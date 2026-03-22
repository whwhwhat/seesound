from __future__ import annotations

import os
import json
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from .base import BaseTheme
from ..themes import create_theme
from ..progress import ProgressTracker, log


def _build_state_snapshots(theme: BaseTheme, frames: list[dict[str, Any]]) -> list[dict[str, Any]]:
    state = theme.initial_state()
    snapshots: list[dict[str, Any]] = []
    tracker = ProgressTracker("Preparing frame states", len(frames), every=max(10, len(frames) // 20))
    for frame in frames:
        state = theme.evolve_state(state, frame)
        snapshots.append(state)
        tracker.update(int(frame["index"]) + 1)
    return snapshots


def _render_single_frame(
    frame: dict[str, Any],
    state: dict[str, Any],
    total_frames: int,
    width: int,
    height: int,
    fps: int,
    theme_name: str,
    theme_cfg: dict[str, Any],
    frames_dir: str,
) -> int:
    theme = create_theme(
        theme_name,
        width=width,
        height=height,
        fps=fps,
        theme_config=theme_cfg,
    )
    frame_index = int(frame["index"])
    image = theme.render_frame(frame, frame_index=frame_index, total_frames=total_frames, state=state)
    image.save(Path(frames_dir) / f"frame_{frame_index:06d}.png")
    return frame_index


def render_frames(analysis_path: Path, frames_dir: Path, config: dict[str, Any], workers: int | None = None) -> Path:
    with analysis_path.open("r", encoding="utf-8") as f:
        analysis = json.load(f)

    render_cfg = config["render"]
    theme_cfg = render_cfg["theme"]
    width = int(render_cfg["width"])
    height = int(render_cfg["height"])
    fps = int(render_cfg["fps"])

    theme: BaseTheme = create_theme(
        theme_cfg["name"],
        width=width,
        height=height,
        fps=fps,
        theme_config=theme_cfg,
    )
    theme.before_render(frames_dir)

    frames = analysis["frames"]
    total_frames = len(frames)
    snapshots = _build_state_snapshots(theme, frames)

    configured_workers = workers if workers is not None else int(render_cfg.get("workers", 1))
    if configured_workers <= 0:
        configured_workers = max(1, (os.cpu_count() or 1) - 1)

    progress = ProgressTracker("Rendering frames", total_frames, every=max(10, total_frames // 20))
    log(f"Rendering {total_frames} frames with {configured_workers} worker(s)")

    if configured_workers == 1:
        for frame, state in zip(frames, snapshots, strict=True):
            frame_index = int(frame["index"])
            image = theme.render_frame(frame, frame_index=frame_index, total_frames=total_frames, state=state)
            image.save(frames_dir / f"frame_{frame_index:06d}.png")
            progress.update(frame_index + 1)
        return frames_dir

    with ProcessPoolExecutor(max_workers=configured_workers) as executor:
        futures = [
            executor.submit(
                _render_single_frame,
                frame,
                state,
                total_frames,
                width,
                height,
                fps,
                theme_cfg["name"],
                theme_cfg,
                str(frames_dir),
            )
            for frame, state in zip(frames, snapshots, strict=True)
        ]
        completed = 0
        for future in as_completed(futures):
            future.result()
            completed += 1
            progress.update(completed)
    return frames_dir
