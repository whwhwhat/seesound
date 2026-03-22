from __future__ import annotations

import time


def log(message: str) -> None:
    now = time.strftime("%H:%M:%S")
    print(f"[{now}] {message}", flush=True)


class ProgressTracker:
    def __init__(self, label: str, total: int, every: int = 30) -> None:
        self.label = label
        self.total = max(1, total)
        self.every = max(1, every)
        self.start = time.perf_counter()
        self.last = self.start

    def update(self, current: int) -> None:
        if current < self.total and current % self.every != 0:
            return

        now = time.perf_counter()
        elapsed = now - self.start
        processed = max(1, current)
        rate = processed / max(elapsed, 1e-6)
        remaining = max(0, self.total - current)
        eta = remaining / max(rate, 1e-6)
        percent = min(100.0, current / self.total * 100.0)
        log(
            f"{self.label}: {current}/{self.total} ({percent:.1f}%), "
            f"{rate:.2f} fps, ETA {eta:.1f}s"
        )
        self.last = now
