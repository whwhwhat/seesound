import {
  fieldSize,
} from "./constants.js";

const fieldCanvas = document.createElement("canvas");
fieldCanvas.width = fieldSize;
fieldCanvas.height = fieldSize;
const fieldCtx = fieldCanvas.getContext("2d");
const fieldImage = fieldCtx.createImageData(fieldSize, fieldSize);

const directGpuUnderlayCanvas = document.createElement("canvas");
directGpuUnderlayCanvas.width = fieldSize;
directGpuUnderlayCanvas.height = fieldSize;
const directGpuUnderlayCtx = directGpuUnderlayCanvas.getContext("2d");
const directGpuUnderlayImage = directGpuUnderlayCtx.createImageData(fieldSize, fieldSize);

const glowCanvas = document.createElement("canvas");
glowCanvas.width = 2048;
glowCanvas.height = 2048;
const glowCtx = glowCanvas.getContext("2d");

const fieldCellCount = fieldSize * fieldSize;
const fieldStride = fieldSize - 1;

const renderBuffers = {
  field: new Float32Array(fieldCellCount),
  colorWeight: new Float32Array(fieldCellCount),
  colorAccum: new Float32Array(fieldCellCount * 3),
  inactiveBands: new Float32Array(),
  modeContribution: new Float32Array(48),
  modeSharpMix: new Float32Array(48),
  modeBlurMix: new Float32Array(48),
  modeEnabled: new Uint8Array(48),
  modeColor: new Float32Array(48 * 3),
  gpuFieldReadback: new Float32Array(fieldCellCount * 4),
};

const fieldGeometry = {
  nx: new Float32Array(fieldCellCount),
  ny: new Float32Array(fieldCellCount),
  modeRadius: new Float32Array(fieldCellCount),
  circleInteriorMask: new Uint8Array(fieldCellCount),
  squareMask: new Float32Array(fieldCellCount),
  circleMask: new Float32Array(fieldCellCount),
  dither: new Float32Array(fieldCellCount),
};

const bandRangeCache = new Map();
const contourPathCache = {
  key: "",
  path: null,
};
const spatialAtlasCache = {
  key: "",
  sharp: new Float32Array(),
  blurred: new Float32Array(),
  modeCount: 0,
};
const spatialCache = new Map();

export {
  bandRangeCache,
  contourPathCache,
  directGpuUnderlayCanvas,
  directGpuUnderlayCtx,
  directGpuUnderlayImage,
  fieldCanvas,
  fieldCellCount,
  fieldCtx,
  fieldGeometry,
  fieldImage,
  fieldStride,
  glowCanvas,
  glowCtx,
  renderBuffers,
  spatialAtlasCache,
  spatialCache,
};
