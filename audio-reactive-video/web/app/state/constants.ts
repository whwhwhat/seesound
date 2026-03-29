import type {
  RGBColor,
  ThemeKey,
  ThemePreset,
} from "../types";

const fieldSize = 384;
const FFT_SIZE = 2048;
const BESSEL_ZEROS: Record<number, number[]> = {
  0: [2.4048, 5.5201, 8.6537],
  1: [3.8317, 7.0156, 10.1735],
  2: [5.1356, 8.4172, 11.6198],
  3: [6.3802, 9.761, 13.0152],
  4: [7.5883, 11.0647, 14.3725],
  5: [8.7715, 12.3386, 15.7002],
  6: [9.9361, 13.5893, 17.0038],
  7: [11.0864, 14.8213, 18.2883],
  8: [12.2251, 16.0378, 19.5576],
};
const THEME_PRESETS: Record<ThemeKey, ThemePreset> = {
  lab: {
    low: [108, 122, 43],
    mid: [188, 222, 72],
    high: [188, 244, 255],
  },
  amber: {
    low: [96, 56, 20],
    mid: [215, 144, 52],
    high: [255, 223, 168],
  },
  ice: {
    low: [28, 84, 88],
    mid: [102, 214, 220],
    high: [228, 250, 255],
  },
  heat: {
    low: [84, 18, 18],
    mid: [230, 96, 48],
    high: [255, 226, 126],
  },
  mono: {
    low: [76, 92, 82],
    mid: [160, 188, 168],
    high: [232, 240, 235],
  },
  aurora: {
    low: [36, 64, 96],
    mid: [88, 224, 182],
    high: [214, 255, 238],
  },
  sunset: {
    low: [86, 32, 72],
    mid: [234, 110, 88],
    high: [255, 214, 132],
  },
  neon: {
    low: [34, 18, 86],
    mid: [255, 54, 139],
    high: [90, 246, 255],
  },
  ocean: {
    low: [18, 58, 88],
    mid: [42, 140, 196],
    high: [172, 240, 255],
  },
};
const BASE_BG_COLOR: RGBColor = [2, 6, 9];
const COLOR_FOCUS_LOW_HZ = 60;
const COLOR_FOCUS_HIGH_HZ = 6000;

export {
  BASE_BG_COLOR,
  BESSEL_ZEROS,
  COLOR_FOCUS_HIGH_HZ,
  COLOR_FOCUS_LOW_HZ,
  FFT_SIZE,
  THEME_PRESETS,
  fieldSize,
};
