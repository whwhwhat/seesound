from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any


def deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_config(default_config_path: Path, custom_config_path: Path | None = None) -> dict[str, Any]:
    config = load_json(default_config_path)
    if custom_config_path:
        config = deep_merge(config, load_json(custom_config_path))
    return config
