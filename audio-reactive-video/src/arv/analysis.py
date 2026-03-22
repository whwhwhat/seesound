from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import librosa
import numpy as np

from .progress import log
from .smoothing import smooth_feature


def _normalize(values: np.ndarray, percentile: float = 99.0) -> np.ndarray:
    if values.size == 0:
        return values
    ceiling = np.percentile(values, percentile)
    if ceiling <= 1e-9:
        ceiling = float(np.max(values) or 1.0)
    return np.clip(values / ceiling, 0.0, 1.0)


def _normalize_signal(values: np.ndarray, percentile: float = 99.5) -> np.ndarray:
    if values.size == 0:
        return values
    ceiling = np.percentile(np.abs(values), percentile)
    if ceiling <= 1e-9:
        ceiling = float(np.max(np.abs(values)) or 1.0)
    return np.clip(values / ceiling, -1.0, 1.0)


def _band_energy(power_spectrum: np.ndarray, freqs: np.ndarray, low: float, high: float) -> np.ndarray:
    mask = (freqs >= low) & (freqs < high)
    if not np.any(mask):
        return np.zeros(power_spectrum.shape[1], dtype=np.float64)
    return np.mean(power_spectrum[mask], axis=0)


def _log_band_edges(freqs: np.ndarray, band_count: int, floor_hz: float = 20.0) -> np.ndarray:
    max_hz = float(np.max(freqs))
    return np.geomspace(max(floor_hz, freqs[1]), max_hz, band_count + 1)


def _log_bands(power_spectrum: np.ndarray, freqs: np.ndarray, band_count: int) -> np.ndarray:
    edges = _log_band_edges(freqs, band_count)
    bands = np.zeros((band_count, power_spectrum.shape[1]), dtype=np.float64)
    for index in range(band_count):
        low = edges[index]
        high = edges[index + 1]
        mask = (freqs >= low) & (freqs < high)
        if not np.any(mask):
            continue
        bands[index] = np.mean(power_spectrum[mask], axis=0)
    return bands


def _feature_smoothing(values: np.ndarray, config: dict[str, float]) -> np.ndarray:
    return smooth_feature(
        values,
        attack=float(config["attack"]),
        release=float(config["release"]),
        alpha=float(config["ema"]),
    )


def _resample_signal(values: np.ndarray, target_size: int) -> np.ndarray:
    if target_size <= 0:
        return np.zeros(0, dtype=np.float64)
    if values.size == 0:
        return np.zeros(target_size, dtype=np.float64)
    if values.size == target_size:
        return values.astype(np.float64, copy=True)
    x_src = np.linspace(0.0, 1.0, values.size)
    x_dst = np.linspace(0.0, 1.0, target_size)
    return np.interp(x_dst, x_src, values)


def _build_waveform_windows(
    signal: np.ndarray,
    frame_count: int,
    hop_length: int,
    window_size: int,
    sample_count: int,
) -> np.ndarray:
    windows = np.zeros((frame_count, sample_count), dtype=np.float64)
    if frame_count <= 0 or sample_count <= 0:
        return windows
    padded = np.pad(signal, (window_size, 0), mode="constant")
    for index in range(frame_count):
        end = index * hop_length + window_size
        start = end - window_size
        segment = padded[start:end]
        windows[index] = _resample_signal(segment, sample_count)
    return windows


def _compute_channel_features(
    signal: np.ndarray,
    freqs: np.ndarray,
    sr: int,
    hop_length: int,
    n_fft: int,
    analysis_cfg: dict[str, Any],
) -> dict[str, np.ndarray]:
    stft = librosa.stft(signal, n_fft=n_fft, hop_length=hop_length, center=True)
    magnitude = np.abs(stft)
    power = magnitude ** 2

    return {
        "rms": librosa.feature.rms(S=magnitude, frame_length=n_fft)[0],
        "centroid": librosa.feature.spectral_centroid(S=magnitude, sr=sr)[0],
        "low_energy": _band_energy(power, freqs, *analysis_cfg["low_hz"]),
        "mid_energy": _band_energy(power, freqs, *analysis_cfg["mid_hz"]),
        "high_energy": _band_energy(power, freqs, *analysis_cfg["high_hz"]),
        "bands": _log_bands(power, freqs, int(analysis_cfg["band_count"])),
    }


def _normalize_bundle(bundle: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    return {
        "rms": _normalize(bundle["rms"]),
        "centroid": _normalize(bundle["centroid"]),
        "low_energy": _normalize(bundle["low_energy"]),
        "mid_energy": _normalize(bundle["mid_energy"]),
        "high_energy": _normalize(bundle["high_energy"]),
        "bands": np.vstack([_normalize(band) for band in bundle["bands"]]),
    }


def _smooth_bundle(bundle: dict[str, np.ndarray], smoothing_cfg: dict[str, dict[str, float]]) -> dict[str, np.ndarray]:
    band_smoothing = smoothing_cfg["bands"]
    return {
        "rms": _feature_smoothing(bundle["rms"], smoothing_cfg["rms"]),
        "centroid": _feature_smoothing(bundle["centroid"], smoothing_cfg["centroid"]),
        "low_energy": _feature_smoothing(bundle["low_energy"], smoothing_cfg["low"]),
        "mid_energy": _feature_smoothing(bundle["mid_energy"], smoothing_cfg["mid"]),
        "high_energy": _feature_smoothing(bundle["high_energy"], smoothing_cfg["high"]),
        "bands": np.vstack([_feature_smoothing(band, band_smoothing) for band in bundle["bands"]]),
    }


def analyze_audio(audio_path: Path, output_path: Path, config: dict[str, Any]) -> Path:
    analysis_cfg = config["analysis"]
    fps = int(analysis_cfg["fps"])
    sr = int(analysis_cfg["sample_rate"])
    hop_length = max(1, round(sr / fps))
    n_fft = int(analysis_cfg["n_fft"])
    band_count = int(analysis_cfg["band_count"])
    waveform_cfg = analysis_cfg.get("waveform", {})
    waveform_window_ms = float(waveform_cfg.get("window_ms", 42.0))
    waveform_sample_count = int(waveform_cfg.get("sample_count", 96))
    waveform_percentile = float(waveform_cfg.get("normalize_percentile", 99.5))

    log(f"Analyzing audio: {audio_path}")
    raw_audio, sr = librosa.load(str(audio_path), sr=sr, mono=False)
    if raw_audio.ndim == 1:
        channels = np.vstack([raw_audio, raw_audio])
        channel_count = 1
    else:
        channels = raw_audio
        channel_count = raw_audio.shape[0]
    mono = np.mean(channels[: min(2, channels.shape[0])], axis=0)
    duration = float(len(mono) / sr)
    log(f"Loaded audio, duration {duration:.2f}s at {sr} Hz")

    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    mono_features = _compute_channel_features(mono, freqs, sr, hop_length, n_fft, analysis_cfg)
    left_signal = channels[0]
    right_signal = channels[1] if channels.shape[0] > 1 else channels[0]
    left_features = _compute_channel_features(left_signal, freqs, sr, hop_length, n_fft, analysis_cfg)
    right_features = _compute_channel_features(right_signal, freqs, sr, hop_length, n_fft, analysis_cfg)
    left_wave_signal = _normalize_signal(left_signal, waveform_percentile)
    right_wave_signal = _normalize_signal(right_signal, waveform_percentile)

    onset_env = librosa.onset.onset_strength(y=mono, sr=sr, hop_length=hop_length)
    _, beat_frames = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr, hop_length=hop_length, units="frames")

    frame_count = min(
        len(mono_features["rms"]),
        len(mono_features["centroid"]),
        len(left_features["rms"]),
        len(right_features["rms"]),
        len(onset_env),
    )
    times = librosa.frames_to_time(np.arange(frame_count), sr=sr, hop_length=hop_length)

    onset_env = onset_env[:frame_count]
    for bundle in (mono_features, left_features, right_features):
        for key, value in bundle.items():
            if key == "bands":
                bundle[key] = value[:, :frame_count]
            else:
                bundle[key] = value[:frame_count]

    beat_signal = np.zeros(frame_count, dtype=np.float64)
    beat_frames = beat_frames[beat_frames < frame_count]
    beat_signal[beat_frames] = 1.0
    beat_signal = np.maximum(beat_signal, _normalize(onset_env, percentile=99.5) * 0.7)

    mono_features = _normalize_bundle(mono_features)
    left_features = _normalize_bundle(left_features)
    right_features = _normalize_bundle(right_features)
    onset_env = _normalize(onset_env)

    smoothing_cfg = analysis_cfg["smoothing"]
    mono_smoothed = _smooth_bundle(mono_features, smoothing_cfg)
    left_smoothed = _smooth_bundle(left_features, smoothing_cfg)
    right_smoothed = _smooth_bundle(right_features, smoothing_cfg)
    onset_smoothed = _feature_smoothing(onset_env, smoothing_cfg["onset"])
    beat_smoothed = _feature_smoothing(beat_signal, smoothing_cfg["onset"])
    waveform_window_size = max(8, int(round(sr * waveform_window_ms / 1000.0)))
    left_waveforms = _build_waveform_windows(left_wave_signal, frame_count, hop_length, waveform_window_size, waveform_sample_count)
    right_waveforms = _build_waveform_windows(right_wave_signal, frame_count, hop_length, waveform_window_size, waveform_sample_count)

    frames: list[dict[str, Any]] = []
    for index in range(frame_count):
        frames.append(
            {
                "index": index,
                "time": round(float(times[index]), 6),
                "rms": round(float(mono_smoothed["rms"][index]), 6),
                "low_energy": round(float(mono_smoothed["low_energy"][index]), 6),
                "mid_energy": round(float(mono_smoothed["mid_energy"][index]), 6),
                "high_energy": round(float(mono_smoothed["high_energy"][index]), 6),
                "centroid": round(float(mono_smoothed["centroid"][index]), 6),
                "onset": round(float(onset_smoothed[index]), 6),
                "beat": round(float(beat_smoothed[index]), 6),
                "bands": [round(float(value), 6) for value in mono_smoothed["bands"][:, index]],
                "left_rms": round(float(left_smoothed["rms"][index]), 6),
                "right_rms": round(float(right_smoothed["rms"][index]), 6),
                "left_low_energy": round(float(left_smoothed["low_energy"][index]), 6),
                "right_low_energy": round(float(right_smoothed["low_energy"][index]), 6),
                "left_mid_energy": round(float(left_smoothed["mid_energy"][index]), 6),
                "right_mid_energy": round(float(right_smoothed["mid_energy"][index]), 6),
                "left_high_energy": round(float(left_smoothed["high_energy"][index]), 6),
                "right_high_energy": round(float(right_smoothed["high_energy"][index]), 6),
                "left_centroid": round(float(left_smoothed["centroid"][index]), 6),
                "right_centroid": round(float(right_smoothed["centroid"][index]), 6),
                "left_bands": [round(float(value), 6) for value in left_smoothed["bands"][:, index]],
                "right_bands": [round(float(value), 6) for value in right_smoothed["bands"][:, index]],
                "left_waveform": [round(float(value), 6) for value in left_waveforms[index]],
                "right_waveform": [round(float(value), 6) for value in right_waveforms[index]],
            }
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "meta": {
            "audio_file": str(audio_path),
            "duration": round(duration, 6),
            "sample_rate": sr,
            "fps": fps,
            "frame_count": frame_count,
            "band_count": band_count,
            "hop_length": hop_length,
            "channel_count": channel_count,
            "waveform_window_ms": waveform_window_ms,
            "waveform_sample_count": waveform_sample_count,
        },
        "frames": frames,
    }
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    log(f"Wrote analysis: {output_path}")
    return output_path
