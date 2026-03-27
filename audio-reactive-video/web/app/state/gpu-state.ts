import {
  fieldSize,
} from "./constants";
import GPU_FIELD_FRAGMENT_SHADER from "../shaders/glsl/gpu-field.frag.glsl?raw";
import GPU_FIELD_VERTEX_SHADER from "../shaders/glsl/gpu-field.vert.glsl?raw";
import GPU_SHADE_FRAGMENT_SHADER from "../shaders/glsl/gpu-shade.frag.glsl?raw";
import GPU_SHADE_VERTEX_SHADER from "../shaders/glsl/gpu-shade.vert.glsl?raw";
import type {
  GpuFieldPipelineState,
  GpuFieldValidationState,
  GpuShadePipelineState,
} from "../types";

const gpuShadePipeline: GpuShadePipelineState = {
  program: null,
  positionBuffer: null,
  ditherTexture: null,
  attribs: null,
  uniforms: null,
  uploadedDither: false,
  available: false,
};

const gpuFieldValidation: GpuFieldValidationState = {
  frame: 0,
  lastComparedFrame: -1,
  maxAbsDiff: 0,
  meanAbsDiff: 0,
};

const gpuFieldPipeline: GpuFieldPipelineState = {
  gl: null,
  available: false,
  program: null,
  positionBuffer: null,
  framebuffer: null,
  outputTexture: null,
  colorAccumTexture: null,
  colorWeightTexture: null,
  sharpAtlasTexture: null,
  blurredAtlasTexture: null,
  modeStateTexture: null,
  attribs: null,
  uniforms: null,
  uploadedSpatialKey: "",
  outputInternalFormat: 0,
  outputType: 0,
};

export {
  GPU_FIELD_FRAGMENT_SHADER,
  GPU_FIELD_VERTEX_SHADER,
  GPU_SHADE_FRAGMENT_SHADER,
  GPU_SHADE_VERTEX_SHADER,
  gpuFieldPipeline,
  gpuFieldValidation,
  gpuShadePipeline,
};
