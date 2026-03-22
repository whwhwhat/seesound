from __future__ import annotations

import numpy as np


def attack_release_smooth(values: np.ndarray, attack: float, release: float) -> np.ndarray:
    result = np.zeros_like(values, dtype=np.float64)
    if values.size == 0:
        return result

    result[0] = values[0]
    for i in range(1, values.size):
        coeff = attack if values[i] > result[i - 1] else release
        result[i] = result[i - 1] + coeff * (values[i] - result[i - 1])
    return result


def ema(values: np.ndarray, alpha: float) -> np.ndarray:
    result = np.zeros_like(values, dtype=np.float64)
    if values.size == 0:
        return result

    result[0] = values[0]
    for i in range(1, values.size):
        result[i] = alpha * values[i] + (1.0 - alpha) * result[i - 1]
    return result


def smooth_feature(values: np.ndarray, attack: float, release: float, alpha: float) -> np.ndarray:
    return ema(attack_release_smooth(values, attack, release), alpha)
