from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

from .analysis import analyze_audio
from .progress import log
from .render import render_frames


def run_export(audio_path: Path, output_path: Path, config: dict[str, Any], workers: int | None = None) -> Path:
    export_cfg = config["export"]
    work_dir = Path(export_cfg["work_dir"])
    analysis_path = work_dir / export_cfg["analysis_file"]
    frames_dir = work_dir / export_cfg["frames_dir"]

    log("Phase 1/3: audio analysis")
    analyze_audio(audio_path=audio_path, output_path=analysis_path, config=config)
    log("Phase 2/3: frame rendering")
    render_frames(analysis_path=analysis_path, frames_dir=frames_dir, config=config, workers=workers)
    log("Phase 3/3: video muxing")
    mux_video(
        frames_dir=frames_dir,
        audio_path=audio_path,
        output_path=output_path,
        fps=int(config["render"]["fps"]),
        export_config=export_cfg,
    )
    return output_path


def mux_video(frames_dir: Path, audio_path: Path, output_path: Path, fps: int, export_config: dict[str, Any]) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    log(f"Muxing frames from {frames_dir} into {output_path}")
    command = [
        "ffmpeg",
        "-y",
        "-framerate",
        str(fps),
        "-i",
        str(frames_dir / "frame_%06d.png"),
        "-i",
        str(audio_path),
        "-c:v",
        export_config["video_codec"],
        "-preset",
        export_config["preset"],
        "-crf",
        str(export_config["crf"]),
        "-pix_fmt",
        export_config["pix_fmt"],
        "-c:a",
        export_config["audio_codec"],
        "-shortest",
        str(output_path),
    ]
    subprocess.run(command, check=True)
    log(f"Wrote video: {output_path}")
    return output_path
