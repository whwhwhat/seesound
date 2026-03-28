import {
  colorPickerHandle,
  colorPickerHex,
  colorPickerHue,
  colorPickerHueHandle,
  colorPickerPopover,
  colorPickerPreview,
  colorPickerR,
  colorPickerG,
  colorPickerB,
  colorPickerSurface,
  colorPickerValue,
  highColorButton,
  highColorInput,
  lowColorButton,
  lowColorInput,
  midColorButton,
  midColorInput,
  themeSelect,
  themeValue,
} from "../state/dom";
import {
  state,
} from "../state/runtime-state";
import {
  requestRender,
} from "../render/renderer";
import {
  clamp,
  hexToRgb,
  rgbToHex,
} from "../core/utils";

let colorPickerBound = false;

function bindColorPicker() {
  if (colorPickerBound) {
    return;
  }
  colorPickerBound = true;

  let openColorInput: HTMLInputElement | null = null;
  let openColorButton: HTMLButtonElement | null = null;
  let colorPickerHueValue = 0;
  let colorPickerSaturation = 0;
  let colorPickerValueLevel = 0;
  let colorDragCleanup: (() => void) | null = null;

  const updateThemeLabel = () => {
    themeValue.textContent = themeSelect.selectedOptions[0]?.textContent ?? "";
  };

  const rgbToHsv = ([red, green, blue]: [number, number, number]) => {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let hue = 0;
    if (delta > 0) {
      if (max === r) {
        hue = 60 * (((g - b) / delta) % 6);
      } else if (max === g) {
        hue = 60 * (((b - r) / delta) + 2);
      } else {
        hue = 60 * (((r - g) / delta) + 4);
      }
    }
    if (hue < 0) {
      hue += 360;
    }
    const saturation = max === 0 ? 0 : delta / max;
    return {
      hue,
      saturation,
      value: max,
    };
  };

  const hsvToRgb = (hue: number, saturation: number, value: number) => {
    const normalizedHue = ((hue % 360) + 360) % 360;
    const chroma = value * saturation;
    const segment = normalizedHue / 60;
    const x = chroma * (1 - Math.abs((segment % 2) - 1));
    let red = 0;
    let green = 0;
    let blue = 0;
    if (segment >= 0 && segment < 1) {
      red = chroma;
      green = x;
    } else if (segment < 2) {
      red = x;
      green = chroma;
    } else if (segment < 3) {
      green = chroma;
      blue = x;
    } else if (segment < 4) {
      green = x;
      blue = chroma;
    } else if (segment < 5) {
      red = x;
      blue = chroma;
    } else {
      red = chroma;
      blue = x;
    }
    const match = value - chroma;
    return [
      Math.round((red + match) * 255),
      Math.round((green + match) * 255),
      Math.round((blue + match) * 255),
    ] as [number, number, number];
  };

  const syncColorButton = (button: HTMLButtonElement, input: HTMLInputElement) => {
    button.style.setProperty("--swatch-color", input.value);
  };

  const updateColorPickerVisuals = () => {
    const hex = rgbToHex(hsvToRgb(colorPickerHueValue, colorPickerSaturation, colorPickerValueLevel)).toUpperCase();
    const [red, green, blue] = hexToRgb(hex);
    colorPickerSurface.style.setProperty("--picker-hue", `hsl(${colorPickerHueValue} 100% 50%)`);
    colorPickerPreview.style.setProperty("--picker-preview", hex);
    colorPickerValue.textContent = hex;
    colorPickerHex.value = hex;
    colorPickerR.value = String(red);
    colorPickerG.value = String(green);
    colorPickerB.value = String(blue);
    colorPickerHandle.style.left = `${colorPickerSaturation * 100}%`;
    colorPickerHandle.style.top = `${(1 - colorPickerValueLevel) * 100}%`;
    colorPickerHueHandle.style.left = `${(colorPickerHueValue / 360) * 100}%`;
  };

  const applyPickerColor = () => {
    if (!openColorInput || !openColorButton) {
      return;
    }
    const hex = rgbToHex(hsvToRgb(colorPickerHueValue, colorPickerSaturation, colorPickerValueLevel));
    openColorInput.value = hex;
    syncColorButton(openColorButton, openColorInput);
    openColorInput.dispatchEvent(new Event("input", { bubbles: true }));
    requestRender();
  };

  const closeColorPicker = () => {
    colorDragCleanup?.();
    colorDragCleanup = null;
    colorPickerPopover.hidden = true;
    openColorButton?.classList.remove("is-open");
    openColorInput = null;
    openColorButton = null;
  };

  const openForButton = (button: HTMLButtonElement, input: HTMLInputElement) => {
    openColorInput = input;
    openColorButton = button;
    button.classList.add("is-open");
    const hsv = rgbToHsv(hexToRgb(input.value));
    colorPickerHueValue = hsv.hue;
    colorPickerSaturation = hsv.saturation;
    colorPickerValueLevel = hsv.value;
    colorPickerHue.value = String(Math.round(hsv.hue));
    updateColorPickerVisuals();

    const rect = button.getBoundingClientRect();
    colorPickerPopover.hidden = false;
    const pickerRect = colorPickerPopover.getBoundingClientRect();
    const pickerWidth = pickerRect.width || 296;
    const pickerHeight = pickerRect.height || 364;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const centeredLeft = rect.left + rect.width / 2 - pickerWidth / 2;
    const left = clamp(centeredLeft, 16, viewportWidth - pickerWidth - 16);
    const preferredTop = rect.top - pickerHeight - 8;
    const top = preferredTop >= 16
      ? preferredTop
      : clamp(rect.bottom + 8, 16, viewportHeight - pickerHeight - 16);
    colorPickerPopover.style.left = `${left}px`;
    colorPickerPopover.style.top = `${top}px`;
  };

  const wireColorButton = (button: HTMLButtonElement, input: HTMLInputElement) => {
    syncColorButton(button, input);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (openColorInput === input) {
        closeColorPicker();
        return;
      }
      closeColorPicker();
      openForButton(button, input);
    });

    input.addEventListener("input", () => {
      syncColorButton(button, input);
      state.lowBandColor = hexToRgb(lowColorInput.value);
      state.midBandColor = hexToRgb(midColorInput.value);
      state.highBandColor = hexToRgb(highColorInput.value);
      state.activeTheme = "custom";
      themeSelect.value = "custom";
      updateThemeLabel();
    });

    input.addEventListener("change", () => {
      syncColorButton(button, input);
    });
  };

  wireColorButton(lowColorButton, lowColorInput);
  wireColorButton(midColorButton, midColorInput);
  wireColorButton(highColorButton, highColorInput);

  colorPickerPopover.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  colorPickerHue.addEventListener("input", () => {
    colorPickerHueValue = Number.parseFloat(colorPickerHue.value);
    updateColorPickerVisuals();
    applyPickerColor();
  });

  colorPickerHex.addEventListener("change", () => {
    const normalized = colorPickerHex.value.trim().replace(/^#?([0-9a-fA-F]{6}).*$/, "#$1");
    if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) {
      updateColorPickerVisuals();
      return;
    }
    const hsv = rgbToHsv(hexToRgb(normalized));
    colorPickerHueValue = hsv.hue;
    colorPickerSaturation = hsv.saturation;
    colorPickerValueLevel = hsv.value;
    colorPickerHue.value = String(Math.round(hsv.hue));
    updateColorPickerVisuals();
    applyPickerColor();
  });

  const applyRgbInputs = () => {
    const red = clamp(Number.parseInt(colorPickerR.value || "0", 10), 0, 255);
    const green = clamp(Number.parseInt(colorPickerG.value || "0", 10), 0, 255);
    const blue = clamp(Number.parseInt(colorPickerB.value || "0", 10), 0, 255);
    const hsv = rgbToHsv([red, green, blue]);
    colorPickerHueValue = hsv.hue;
    colorPickerSaturation = hsv.saturation;
    colorPickerValueLevel = hsv.value;
    colorPickerHue.value = String(Math.round(hsv.hue));
    updateColorPickerVisuals();
    applyPickerColor();
  };

  [colorPickerR, colorPickerG, colorPickerB].forEach((input) => {
    input.addEventListener("change", applyRgbInputs);
  });

  const beginSurfaceDrag = (event: PointerEvent) => {
    event.preventDefault();
    colorPickerSurface.setPointerCapture(event.pointerId);
    const updateFromPointer = (pointerEvent: PointerEvent) => {
      const rect = colorPickerSurface.getBoundingClientRect();
      colorPickerSaturation = clamp((pointerEvent.clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
      colorPickerValueLevel = clamp(1 - (pointerEvent.clientY - rect.top) / Math.max(rect.height, 1), 0, 1);
      updateColorPickerVisuals();
      applyPickerColor();
    };
    updateFromPointer(event);
    const handleMove = (pointerEvent: PointerEvent) => {
      updateFromPointer(pointerEvent);
    };
    const handleEnd = (pointerEvent: PointerEvent) => {
      colorPickerSurface.releasePointerCapture(pointerEvent.pointerId);
      colorPickerSurface.removeEventListener("pointermove", handleMove);
      colorPickerSurface.removeEventListener("pointerup", handleEnd);
      colorPickerSurface.removeEventListener("pointercancel", handleEnd);
      colorDragCleanup = null;
    };
    colorPickerSurface.addEventListener("pointermove", handleMove);
    colorPickerSurface.addEventListener("pointerup", handleEnd);
    colorPickerSurface.addEventListener("pointercancel", handleEnd);
    colorDragCleanup = () => {
      colorPickerSurface.removeEventListener("pointermove", handleMove);
      colorPickerSurface.removeEventListener("pointerup", handleEnd);
      colorPickerSurface.removeEventListener("pointercancel", handleEnd);
    };
  };

  colorPickerSurface.addEventListener("pointerdown", beginSurfaceDrag);

  document.addEventListener("click", () => {
    closeColorPicker();
  });
}

export {
  bindColorPicker,
};
