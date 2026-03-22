from __future__ import annotations

import argparse
from pathlib import Path

from .config import load_config


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="audio-reactive-video")
    parser.add_argument(
        "--default-config",
        default=str(Path(__file__).resolve().parents[2] / "config.default.json"),
        help="Path to the built-in default config.",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    analyze = subparsers.add_parser("analyze", help="Analyze audio and write analysis.json.")
    analyze.add_argument("--input", required=True, help="Input audio file.")
    analyze.add_argument("--output", required=True, help="Output analysis JSON file.")
    analyze.add_argument("--config", help="Optional config override JSON.")

    render = subparsers.add_parser("render", help="Render PNG frames from analysis JSON.")
    render.add_argument("--analysis", required=True, help="Path to analysis.json.")
    render.add_argument("--frames-dir", required=True, help="Directory for rendered frames.")
    render.add_argument("--config", help="Optional config override JSON.")
    render.add_argument("--workers", type=int, help="Number of parallel render workers. 1 disables multiprocessing.")

    mux = subparsers.add_parser("mux", help="Mux frames and audio into mp4 with ffmpeg.")
    mux.add_argument("--frames-dir", required=True, help="Directory containing rendered PNG frames.")
    mux.add_argument("--audio", required=True, help="Original audio file.")
    mux.add_argument("--output", required=True, help="Output MP4 path.")
    mux.add_argument("--fps", type=int, required=True, help="Frame rate.")
    mux.add_argument("--config", help="Optional config override JSON.")

    export = subparsers.add_parser("export", help="Run analyze, render, and mux.")
    export.add_argument("--input", required=True, help="Input audio file.")
    export.add_argument("--output", required=True, help="Output MP4 path.")
    export.add_argument("--config", help="Optional config override JSON.")
    export.add_argument("--workers", type=int, help="Number of parallel render workers. 1 disables multiprocessing.")

    web_preview = subparsers.add_parser("web-preview", help="Serve the local Web realtime preview app.")
    web_preview.add_argument("--host", default="127.0.0.1", help="Host to bind the preview server.")
    web_preview.add_argument("--port", type=int, default=8765, help="Port to bind the preview server.")

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    config = load_config(
        default_config_path=Path(args.default_config),
        custom_config_path=Path(args.config) if getattr(args, "config", None) else None,
    )

    command = args.command
    if command == "analyze":
        from .analysis import analyze_audio

        analyze_audio(Path(args.input), Path(args.output), config)
    elif command == "render":
        from .render import render_frames

        render_frames(Path(args.analysis), Path(args.frames_dir), config, workers=args.workers)
    elif command == "mux":
        from .export import mux_video

        mux_video(
            frames_dir=Path(args.frames_dir),
            audio_path=Path(args.audio),
            output_path=Path(args.output),
            fps=int(args.fps),
            export_config=config["export"],
        )
    elif command == "export":
        from .export import run_export

        run_export(audio_path=Path(args.input), output_path=Path(args.output), config=config, workers=args.workers)
    elif command == "web-preview":
        from .web_preview import serve_web_preview

        serve_web_preview(host=str(args.host), port=int(args.port))
    else:
        parser.error(f"Unsupported command: {command}")


if __name__ == "__main__":
    main()
