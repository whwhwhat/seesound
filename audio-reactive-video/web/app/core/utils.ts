import type {
  RGBColor,
} from "../types";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function lerpColor(a: RGBColor, b: RGBColor, t: number): RGBColor {
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
  ];
}

function mixColor3(a: RGBColor, b: RGBColor, c: RGBColor, t: number): RGBColor {
  if (t <= 0.5) {
    return lerpColor(a, b, t * 2);
  }
  return lerpColor(b, c, (t - 0.5) * 2);
}

function toRgba(color: RGBColor, alpha: number): string {
  return `rgba(${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])}, ${alpha})`;
}

function rgbToHex(color: RGBColor): string {
  return `#${color.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex: string): RGBColor {
  const normalized = hex.replace("#", "");
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function noise2D(x: number, y: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function factorial(value: number): number {
  if (value <= 1) {
    return 1;
  }
  let result = 1;
  for (let index = 2; index <= value; index += 1) {
    result *= index;
  }
  return result;
}

function besselJ(order: number, x: number): number {
  let sum = 0;
  for (let k = 0; k < 20; k += 1) {
    const numerator = Math.pow(-1, k) * Math.pow(x / 2, 2 * k + order);
    const denominator = factorial(k) * factorial(k + order);
    sum += numerator / denominator;
  }
  return sum;
}

function toMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

export {
  besselJ,
  clamp,
  factorial,
  hexToRgb,
  lerp,
  lerpColor,
  mixColor3,
  noise2D,
  rgbToHex,
  smoothstep,
  toMel,
  toRgba,
};
