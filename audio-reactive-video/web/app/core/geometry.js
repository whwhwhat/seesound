import {
  BASE_BG_COLOR,
  BESSEL_ZEROS,
  FFT_SIZE,
  bandRangeCache,
  directGpuUnderlayCtx,
  directGpuUnderlayImage,
  fieldCellCount,
  fieldGeometry,
  fieldSize,
  fieldStride,
  numericControls,
  renderBuffers,
  spatialAtlasCache,
  spatialCache,
  state,
} from "../state/context.js";
import {
  besselJ,
  clamp,
  noise2D,
  smoothstep,
} from "./utils.js";

function initializeFieldGeometry() {
  let ptr = 0;
  for (let y = 0; y < fieldSize; y += 1) {
    const nyField = y / fieldStride - 0.5;
    const nyMode = (y / fieldStride) * 2 - 1;
    for (let x = 0; x < fieldSize; x += 1) {
      const nxField = x / fieldStride - 0.5;
      const nxMode = (x / fieldStride) * 2 - 1;
      const distance = Math.sqrt(nxField * nxField + nyField * nyField);
      const modeRadius = Math.sqrt(nxMode * nxMode + nyMode * nyMode);
      const radius = distance / 0.72;
      fieldGeometry.nx[ptr] = nxMode;
      fieldGeometry.ny[ptr] = nyMode;
      fieldGeometry.modeRadius[ptr] = modeRadius;
      fieldGeometry.circleInteriorMask[ptr] = modeRadius <= 1 ? 1 : 0;
      fieldGeometry.squareMask[ptr] = Math.max(0, 1 - radius * radius);
      fieldGeometry.circleMask[ptr] = 1 - smoothstep(0.5 - 2.5 / fieldSize, 0.5 + 1.5 / fieldSize, distance);
      fieldGeometry.dither[ptr] = (noise2D(x + 17, y + 29) - 0.5) * 0.018;
      ptr += 1;
    }
  }
}

function updateDirectGpuUnderlay(field, displayScale, params) {
  const imageData = directGpuUnderlayImage.data;
  const shapeMask = params.plateShape === "circle" ? fieldGeometry.circleMask : fieldGeometry.squareMask;
  const spreadNorm = clamp(params.glowSpread / 2.5, 0.08, 4.0);
  let ptr = 0;
  for (let y = 0; y < fieldSize; y += 1) {
    for (let x = 0; x < fieldSize; x += 1) {
      const mask = shapeMask[ptr];
      const value = field[ptr] / Math.max(displayScale, 1e-6);
      const edgeX = x < fieldSize - 1 ? Math.abs(field[ptr] - field[ptr + 1]) / Math.max(displayScale, 1e-6) : 0;
      const edgeY = y < fieldSize - 1 ? Math.abs(field[ptr] - field[ptr + fieldSize]) / Math.max(displayScale, 1e-6) : 0;
      const gradient = Math.min(1, (edgeX + edgeY) * 2.6);
      const absValue = Math.abs(value);
      const nodeHalo = params.renderAsDormantField ? 0 : Math.exp(-absValue * (params.haloSharpness / Math.max(0.35, spreadNorm)));
      const outerHalo = params.renderAsDormantField ? 0 : Math.exp(-absValue * (params.haloSharpness / Math.max(0.22, spreadNorm * 1.45)));
      const displacement = Math.pow(Math.min(1, absValue), params.contrast);
      const backgroundField = displacement * params.backgroundWeight * params.singleAmpGate;
      const underlayStrength = Math.min(
        1,
        (backgroundField * 1.45 + nodeHalo * 0.18 + outerHalo * 0.1 + gradient * 0.06) * mask,
      );
      imageData[ptr * 4] = Math.round(BASE_BG_COLOR[0] + underlayStrength * params.themePalette.backdropColor[0] * 0.38);
      imageData[ptr * 4 + 1] = Math.round(BASE_BG_COLOR[1] + underlayStrength * params.themePalette.backdropColor[1] * 0.4);
      imageData[ptr * 4 + 2] = Math.round(BASE_BG_COLOR[2] + underlayStrength * params.themePalette.backdropColor[2] * 0.46);
      imageData[ptr * 4 + 3] = Math.round(clamp(mask, 0, 1) * 255);
      ptr += 1;
    }
  }
  directGpuUnderlayCtx.putImageData(directGpuUnderlayImage, 0, 0);
}

function getBandRanges(groups, sampleRate) {
  const key = `${groups}:${sampleRate}`;
  if (bandRangeCache.has(key)) {
    return bandRangeCache.get(key);
  }

  const minBin = 2;
  const maxBin = FFT_SIZE / 2 - 1;
  const hzPerBin = sampleRate / FFT_SIZE;
  const ranges = Array.from({ length: groups }, (_, groupIndex) => {
    const startT = groupIndex / groups;
    const endT = (groupIndex + 1) / groups;
    const start = Math.floor(minBin * Math.pow(maxBin / minBin, startT));
    const end = Math.max(start + 1, Math.floor(minBin * Math.pow(maxBin / minBin, endT)));
    return {
      start,
      end,
      lowHz: start * hzPerBin,
      highHz: Math.min((end + 1) * hzPerBin, sampleRate / 2),
    };
  });
  bandRangeCache.set(key, ranges);
  return ranges;
}

function ensureInactiveBands(targetCount) {
  if (renderBuffers.inactiveBands.length !== targetCount) {
    renderBuffers.inactiveBands = new Float32Array(targetCount);
  } else {
    renderBuffers.inactiveBands.fill(0);
  }
  return renderBuffers.inactiveBands;
}

function resetRenderBuffers() {
  renderBuffers.field.fill(0);
  renderBuffers.colorWeight.fill(0);
  renderBuffers.colorAccum.fill(0);
  renderBuffers.modeContribution.fill(0);
  renderBuffers.modeSharpMix.fill(0);
  renderBuffers.modeBlurMix.fill(0);
  renderBuffers.modeEnabled.fill(0);
  renderBuffers.modeColor.fill(0);
}

function blurField(values, width, height, radius = 2) {
  const temp = new Float32Array(values.length);
  const result = new Float32Array(values.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dx = -radius; dx <= radius; dx += 1) {
        const xx = x + dx;
        if (xx < 0 || xx >= width) {
          continue;
        }
        sum += values[y * width + xx];
        count += 1;
      }
      temp[y * width + x] = sum / Math.max(1, count);
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) {
          continue;
        }
        sum += temp[yy * width + x];
        count += 1;
      }
      result[y * width + x] = sum / Math.max(1, count);
    }
  }

  return result;
}

function circleModeValue(n, m, radius, theta, angularRotationDegrees = 0) {
  const zeros = BESSEL_ZEROS[n];
  if (!zeros || !zeros[m - 1]) {
    return 0;
  }
  const znm = zeros[m - 1];
  const kr = znm * radius;
  const radial = besselJ(n, kr);
  const rotation = (angularRotationDegrees * Math.PI) / 180;
  const angular = Math.cos(n * theta - rotation);
  return radial * angular;
}

function getSpatialMode(m, n) {
  const angularRotation = state.plateShape === "circle"
    ? numericControls.angularRotation
    : 0;
  const key = `${state.plateShape}:${m}:${n}:${angularRotation.toFixed(2)}`;
  if (spatialCache.has(key)) {
    return spatialCache.get(key);
  }

  const sharp = new Float32Array(fieldCellCount);
  for (let ptr = 0; ptr < fieldCellCount; ptr += 1) {
    const nx = fieldGeometry.nx[ptr];
    const ny = fieldGeometry.ny[ptr];
    let mode = 0;
    if (state.plateShape === "circle") {
      const radius = fieldGeometry.modeRadius[ptr];
      if (radius <= 1) {
        const theta = Math.atan2(ny, nx);
        mode = circleModeValue(n, m, radius, theta, angularRotation);
      }
    } else {
      mode =
        Math.cos(n * Math.PI * nx) * Math.cos(m * Math.PI * ny) -
        Math.cos(m * Math.PI * nx) * Math.cos(n * Math.PI * ny);
    }
    sharp[ptr] = mode;
  }
  const blurred = blurField(sharp, fieldSize, fieldSize, 3);
  const bundle = { sharp, blurred };
  spatialCache.set(key, bundle);
  return bundle;
}

function getSpatialAtlasKey() {
  const angularRotation = state.plateShape === "circle" ? numericControls.angularRotation.toFixed(2) : "0.00";
  return `${state.plateShape}:${angularRotation}:${state.modeState.length}`;
}

function ensureSpatialAtlas() {
  const key = getSpatialAtlasKey();
  if (spatialAtlasCache.key === key) {
    return spatialAtlasCache;
  }

  const modeCount = state.modeState.length;
  const atlasLength = fieldCellCount * modeCount;
  if (spatialAtlasCache.sharp.length !== atlasLength) {
    spatialAtlasCache.sharp = new Float32Array(atlasLength);
    spatialAtlasCache.blurred = new Float32Array(atlasLength);
  }

  for (let index = 0; index < modeCount; index += 1) {
    const mode = state.modeState[index];
    const spatial = getSpatialMode(mode.m, mode.n);
    spatialAtlasCache.sharp.set(spatial.sharp, index * fieldCellCount);
    spatialAtlasCache.blurred.set(spatial.blurred, index * fieldCellCount);
  }

  spatialAtlasCache.key = key;
  spatialAtlasCache.modeCount = modeCount;
  return spatialAtlasCache;
}

function percentileOfField(field, q, requireCircleInterior = false) {
  const values = [];
  for (let ptr = 0; ptr < field.length; ptr += 1) {
    if (requireCircleInterior && fieldGeometry.circleInteriorMask[ptr] === 0) {
      continue;
    }
    values.push(field[ptr]);
  }
  if (values.length === 0) {
    return 0;
  }
  values.sort((a, b) => a - b);
  const index = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * q)));
  return values[index];
}

function removeRadialAverage(field) {
  const bucketCount = Math.max(32, Math.floor(fieldSize * 0.7));
  const sums = new Float32Array(bucketCount);
  const counts = new Float32Array(bucketCount);

  for (let ptr = 0; ptr < field.length; ptr += 1) {
    const radius = Math.min(1, fieldGeometry.modeRadius[ptr]);
    const bucket = Math.min(bucketCount - 1, Math.floor(radius * (bucketCount - 1)));
    sums[bucket] += field[ptr];
    counts[bucket] += 1;
  }

  const averages = new Float32Array(bucketCount);
  for (let index = 0; index < bucketCount; index += 1) {
    averages[index] = counts[index] > 0 ? sums[index] / counts[index] : 0;
  }

  for (let ptr = 0; ptr < field.length; ptr += 1) {
    const radius = Math.min(1, fieldGeometry.modeRadius[ptr]);
    const bucket = Math.min(bucketCount - 1, Math.floor(radius * (bucketCount - 1)));
    field[ptr] -= averages[bucket];
  }
}

function clearSpatialCache() {
  spatialCache.clear();
}

export {
  blurField,
  clearSpatialCache,
  ensureInactiveBands,
  ensureSpatialAtlas,
  getBandRanges,
  getSpatialMode,
  initializeFieldGeometry,
  percentileOfField,
  removeRadialAverage,
  resetRenderBuffers,
  updateDirectGpuUnderlay,
};
