import {
  BASE_BG_COLOR,
  canvas,
  fieldCellCount,
  fieldGeometry,
  fieldSize,
  glCanvas,
  gpuFieldPipeline,
  gpuFieldValidation,
  gpuShadePipeline,
  renderBuffers,
  state,
} from "../state/context";
import GPU_FIELD_FRAGMENT_SHADER from "../shaders/glsl/gpu-field.frag.glsl?raw";
import GPU_FIELD_VERTEX_SHADER from "../shaders/glsl/gpu-field.vert.glsl?raw";
import GPU_SHADE_FRAGMENT_SHADER from "../shaders/glsl/gpu-shade.frag.glsl?raw";
import GPU_SHADE_VERTEX_SHADER from "../shaders/glsl/gpu-shade.vert.glsl?raw";
import type {
  GpuShadeParams,
  InitializedGpuFieldPipeline,
  InitializedGpuShadePipeline,
  ModeRenderState,
  SpatialAtlasCache,
} from "../types";

function requireGl(): WebGL2RenderingContext {
  const gl = gpuFieldPipeline.gl;
  if (!gl) {
    throw new Error("GPU field pipeline WebGL context is unavailable.");
  }
  return gl;
}

function requireFieldPipeline(): InitializedGpuFieldPipeline {
  if (
    !gpuFieldPipeline.gl ||
    !gpuFieldPipeline.program ||
    !gpuFieldPipeline.positionBuffer ||
    !gpuFieldPipeline.framebuffer ||
    !gpuFieldPipeline.outputTexture ||
    !gpuFieldPipeline.colorAccumTexture ||
    !gpuFieldPipeline.colorWeightTexture ||
    !gpuFieldPipeline.sharpAtlasTexture ||
    !gpuFieldPipeline.blurredAtlasTexture ||
    !gpuFieldPipeline.modeStateTexture ||
    !gpuFieldPipeline.attribs ||
    !gpuFieldPipeline.uniforms
  ) {
    throw new Error("GPU field pipeline is not initialized.");
  }
  return gpuFieldPipeline as InitializedGpuFieldPipeline;
}

function requireShadePipeline(): InitializedGpuShadePipeline {
  if (
    !gpuShadePipeline.program ||
    !gpuShadePipeline.positionBuffer ||
    !gpuShadePipeline.ditherTexture ||
    !gpuShadePipeline.attribs ||
    !gpuShadePipeline.uniforms
  ) {
    throw new Error("GPU shade pipeline is not initialized.");
  }
  return gpuShadePipeline as InitializedGpuShadePipeline;
}

function createGlShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Unable to create WebGL shader.");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(message || "GPU shader compilation failed");
  }
  return shader;
}

function createGlProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const vertexShader = createGlShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createGlShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) {
    throw new Error("Unable to create WebGL program.");
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(message || "GPU program link failed");
  }
  return program;
}

function ensureGpuFieldPipeline(): boolean {
  if (gpuFieldPipeline.available) {
    return true;
  }
  if (gpuFieldPipeline.gl && !gpuFieldPipeline.available) {
    return false;
  }

  const gl = glCanvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
  });
  gpuFieldPipeline.gl = gl;
  if (!gl) {
    return false;
  }

  try {
    const colorBufferFloatExt = gl.getExtension("EXT_color_buffer_float");
    if (!colorBufferFloatExt) {
      console.warn("GPU field pipeline unavailable: EXT_color_buffer_float missing");
      gpuFieldPipeline.available = false;
      return false;
    }

    const program = createGlProgram(gl, GPU_FIELD_VERTEX_SHADER, GPU_FIELD_FRAGMENT_SHADER);
    const positionBuffer = gl.createBuffer();
    const framebuffer = gl.createFramebuffer();
    const outputTexture = gl.createTexture();
    const colorAccumTexture = gl.createTexture();
    const colorWeightTexture = gl.createTexture();
    const sharpAtlasTexture = gl.createTexture();
    const blurredAtlasTexture = gl.createTexture();
    const modeStateTexture = gl.createTexture();
    if (
      !positionBuffer ||
      !framebuffer ||
      !outputTexture ||
      !colorAccumTexture ||
      !colorWeightTexture ||
      !sharpAtlasTexture ||
      !blurredAtlasTexture ||
      !modeStateTexture
    ) {
      throw new Error("Unable to allocate GPU field pipeline resources.");
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        1, 1,
      ]),
      gl.STATIC_DRAW,
    );

    gl.bindTexture(gl.TEXTURE_2D, outputTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, fieldSize, fieldSize, 0, gl.RGBA, gl.FLOAT, null);

    gl.bindTexture(gl.TEXTURE_2D, colorAccumTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, fieldSize, fieldSize, 0, gl.RGBA, gl.FLOAT, null);

    gl.bindTexture(gl.TEXTURE_2D, colorWeightTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, fieldSize, fieldSize, 0, gl.RGBA, gl.FLOAT, null);

    gl.bindTexture(gl.TEXTURE_2D_ARRAY, sharpAtlasTexture);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindTexture(gl.TEXTURE_2D_ARRAY, blurredAtlasTexture);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindTexture(gl.TEXTURE_2D, modeStateTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 8, 48, 0, gl.RED, gl.FLOAT, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outputTexture, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, colorAccumTexture, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, colorWeightTexture, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);

    gpuFieldPipeline.program = program;
    gpuFieldPipeline.positionBuffer = positionBuffer;
    gpuFieldPipeline.framebuffer = framebuffer;
    gpuFieldPipeline.outputTexture = outputTexture;
    gpuFieldPipeline.colorAccumTexture = colorAccumTexture;
    gpuFieldPipeline.colorWeightTexture = colorWeightTexture;
    gpuFieldPipeline.sharpAtlasTexture = sharpAtlasTexture;
    gpuFieldPipeline.blurredAtlasTexture = blurredAtlasTexture;
    gpuFieldPipeline.modeStateTexture = modeStateTexture;
    gpuFieldPipeline.attribs = {
      position: gl.getAttribLocation(program, "a_position"),
    };
    gpuFieldPipeline.uniforms = {
      sharpAtlas: gl.getUniformLocation(program, "u_sharpAtlas"),
      blurredAtlas: gl.getUniformLocation(program, "u_blurredAtlas"),
      modeState: gl.getUniformLocation(program, "u_modeState"),
      modeCount: gl.getUniformLocation(program, "u_modeCount"),
      singleMode: gl.getUniformLocation(program, "u_singleMode"),
      signedMode: gl.getUniformLocation(program, "u_signedMode"),
      useGlowColor: gl.getUniformLocation(program, "u_useGlowColor"),
    };
    gpuFieldPipeline.outputInternalFormat = gl.RGBA32F;
    gpuFieldPipeline.outputType = gl.FLOAT;
    gpuFieldPipeline.available = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (gpuFieldPipeline.available) {
      console.log("GPU field pipeline ready");
    } else {
      console.warn("GPU field pipeline framebuffer incomplete");
    }
    return gpuFieldPipeline.available;
  } catch (error) {
    console.warn("GPU field pipeline unavailable", error);
    gpuFieldPipeline.available = false;
    return false;
  }
}

function ensureGpuShadePipeline(): boolean {
  if (!gpuFieldPipeline.available) {
    return false;
  }
  if (gpuShadePipeline.available) {
    return true;
  }

  const gl = requireGl();
  try {
    const program = createGlProgram(gl, GPU_SHADE_VERTEX_SHADER, GPU_SHADE_FRAGMENT_SHADER);
    const positionBuffer = gl.createBuffer();
    const ditherTexture = gl.createTexture();
    if (!positionBuffer || !ditherTexture) {
      throw new Error("Unable to allocate GPU shade pipeline resources.");
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        1, 1,
      ]),
      gl.STATIC_DRAW,
    );

    gl.bindTexture(gl.TEXTURE_2D, ditherTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gpuShadePipeline.program = program;
    gpuShadePipeline.positionBuffer = positionBuffer;
    gpuShadePipeline.ditherTexture = ditherTexture;
    gpuShadePipeline.attribs = {
      position: gl.getAttribLocation(program, "a_position"),
    };
    gpuShadePipeline.uniforms = {
      fieldTex: gl.getUniformLocation(program, "u_fieldTex"),
      colorAccumTex: gl.getUniformLocation(program, "u_colorAccumTex"),
      colorWeightTex: gl.getUniformLocation(program, "u_colorWeightTex"),
      ditherTex: gl.getUniformLocation(program, "u_ditherTex"),
      texel: gl.getUniformLocation(program, "u_texel"),
      displayScale: gl.getUniformLocation(program, "u_displayScale"),
      rms: gl.getUniformLocation(program, "u_rms"),
      centroid: gl.getUniformLocation(program, "u_centroid"),
      contrast: gl.getUniformLocation(program, "u_contrast"),
      coreSharpness: gl.getUniformLocation(program, "u_coreSharpness"),
      haloSharpness: gl.getUniformLocation(program, "u_haloSharpness"),
      lineWeight: gl.getUniformLocation(program, "u_lineWeight"),
      haloWeight: gl.getUniformLocation(program, "u_haloWeight"),
      backgroundWeight: gl.getUniformLocation(program, "u_backgroundWeight"),
      singleAmpGate: gl.getUniformLocation(program, "u_singleAmpGate"),
      separation: gl.getUniformLocation(program, "u_separation"),
      renderDormant: gl.getUniformLocation(program, "u_renderDormant"),
      shapeMode: gl.getUniformLocation(program, "u_shapeMode"),
      useGlowColor: gl.getUniformLocation(program, "u_useGlowColor"),
      glowThickness: gl.getUniformLocation(program, "u_glowThickness"),
      glowSpread: gl.getUniformLocation(program, "u_glowSpread"),
      atmosphereEnabled: gl.getUniformLocation(program, "u_atmosphereEnabled"),
      baseBgColor: gl.getUniformLocation(program, "u_baseBgColor"),
      backdropColor: gl.getUniformLocation(program, "u_backdropColor"),
      baseColor: gl.getUniformLocation(program, "u_baseColor"),
      lineColor: gl.getUniformLocation(program, "u_lineColor"),
      outerColor: gl.getUniformLocation(program, "u_outerColor"),
      glowColor: gl.getUniformLocation(program, "u_glowColor"),
      atmosphereCore: gl.getUniformLocation(program, "u_atmosphereCore"),
      atmosphereOuter: gl.getUniformLocation(program, "u_atmosphereOuter"),
    };
    gpuShadePipeline.available = true;
    return true;
  } catch (error) {
    console.warn("GPU shade pipeline unavailable", error);
    gpuShadePipeline.available = false;
    return false;
  }
}

function uploadDitherTexture(): boolean {
  if (!ensureGpuShadePipeline() || gpuShadePipeline.uploadedDither) {
    return gpuShadePipeline.available;
  }
  const gl = requireGl();
  const shadePipeline = requireShadePipeline();
  const ditherPixels = new Float32Array(fieldCellCount);
  for (let ptr = 0; ptr < fieldCellCount; ptr += 1) {
    ditherPixels[ptr] = fieldGeometry.dither[ptr];
  }
  gl.bindTexture(gl.TEXTURE_2D, shadePipeline.ditherTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, fieldSize, fieldSize, 0, gl.RED, gl.FLOAT, ditherPixels);
  gpuShadePipeline.uploadedDither = true;
  return true;
}

function uploadSpatialAtlasToGpu(spatialAtlas: SpatialAtlasCache): boolean {
  if (!ensureGpuFieldPipeline()) {
    return false;
  }
  if (gpuFieldPipeline.uploadedSpatialKey === spatialAtlas.key) {
    return true;
  }

  const gl = requireGl();
  const fieldPipeline = requireFieldPipeline();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, fieldPipeline.sharpAtlasTexture);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R32F, fieldSize, fieldSize, spatialAtlas.modeCount, 0, gl.RED, gl.FLOAT, spatialAtlas.sharp);

  gl.bindTexture(gl.TEXTURE_2D_ARRAY, fieldPipeline.blurredAtlasTexture);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R32F, fieldSize, fieldSize, spatialAtlas.modeCount, 0, gl.RED, gl.FLOAT, spatialAtlas.blurred);

  gpuFieldPipeline.uploadedSpatialKey = spatialAtlas.key;
  return true;
}

function buildGpuModeStateTexture(modeRenderState: ModeRenderState): Float32Array {
  const packed = new Float32Array(8 * 48);
  for (let index = 0; index < state.modeState.length; index += 1) {
    const offset = index * 8;
    packed[offset] = modeRenderState.enabled[index];
    packed[offset + 1] = modeRenderState.contribution[index];
    packed[offset + 2] = modeRenderState.sharpMix[index];
    packed[offset + 3] = modeRenderState.blurMix[index];
    packed[offset + 4] = modeRenderState.color[index * 3];
    packed[offset + 5] = modeRenderState.color[index * 3 + 1];
    packed[offset + 6] = modeRenderState.color[index * 3 + 2];
    packed[offset + 7] = 0;
  }
  return packed;
}

function runGpuFieldAccumulation(
  spatialAtlas: SpatialAtlasCache,
  modeRenderState: ModeRenderState,
  isSingleMode: boolean,
  useGlowColor: boolean,
): boolean {
  if (!uploadSpatialAtlasToGpu(spatialAtlas)) {
    return false;
  }

  const gl = requireGl();
  const fieldPipeline = requireFieldPipeline();
  const packedModeState = buildGpuModeStateTexture(modeRenderState);

  gl.bindTexture(gl.TEXTURE_2D, fieldPipeline.modeStateTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 8, 48, 0, gl.RED, gl.FLOAT, packedModeState);

  gl.viewport(0, 0, fieldSize, fieldSize);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fieldPipeline.framebuffer);
  gl.useProgram(fieldPipeline.program);

  gl.bindBuffer(gl.ARRAY_BUFFER, fieldPipeline.positionBuffer);
  gl.enableVertexAttribArray(fieldPipeline.attribs.position);
  gl.vertexAttribPointer(fieldPipeline.attribs.position, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, fieldPipeline.sharpAtlasTexture);
  gl.uniform1i(fieldPipeline.uniforms.sharpAtlas, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, fieldPipeline.blurredAtlasTexture);
  gl.uniform1i(fieldPipeline.uniforms.blurredAtlas, 1);

  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, fieldPipeline.modeStateTexture);
  gl.uniform1i(fieldPipeline.uniforms.modeState, 2);

  gl.uniform1i(fieldPipeline.uniforms.modeCount, state.modeState.length);
  gl.uniform1i(fieldPipeline.uniforms.singleMode, isSingleMode ? 1 : 0);
  gl.uniform1i(fieldPipeline.uniforms.signedMode, state.combineMode === "signed" ? 1 : 0);
  gl.uniform1i(fieldPipeline.uniforms.useGlowColor, useGlowColor ? 1 : 0);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return true;
}

function shouldValidateGpuField(): boolean {
  if (!gpuFieldPipeline.available) {
    return false;
  }
  if (gpuFieldValidation.lastComparedFrame < 0) {
    return true;
  }
  return gpuFieldValidation.frame - gpuFieldValidation.lastComparedFrame >= 120;
}

function validateGpuFieldAgainstCpu(cpuField: Float32Array): void {
  if (!gpuFieldPipeline.available) {
    return;
  }
  const gl = requireGl();
  const fieldPipeline = requireFieldPipeline();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fieldPipeline.framebuffer);
  gl.readPixels(0, 0, fieldSize, fieldSize, gl.RGBA, gl.FLOAT, renderBuffers.gpuFieldReadback);

  let maxAbsDiff = 0;
  let totalAbsDiff = 0;
  for (let ptr = 0; ptr < fieldCellCount; ptr += 1) {
    const gpuValue = renderBuffers.gpuFieldReadback[ptr * 4];
    const diff = Math.abs(gpuValue - cpuField[ptr]);
    if (diff > maxAbsDiff) {
      maxAbsDiff = diff;
    }
    totalAbsDiff += diff;
  }

  gpuFieldValidation.lastComparedFrame = gpuFieldValidation.frame;
  gpuFieldValidation.maxAbsDiff = maxAbsDiff;
  gpuFieldValidation.meanAbsDiff = totalAbsDiff / Math.max(1, fieldCellCount);
  console.log("GPU field validation", {
    frame: gpuFieldValidation.frame,
    maxAbsDiff: gpuFieldValidation.maxAbsDiff,
    meanAbsDiff: gpuFieldValidation.meanAbsDiff,
  });
}

function readGpuFieldIntoCpuBuffer(targetField: Float32Array): boolean {
  if (!gpuFieldPipeline.available) {
    return false;
  }
  const gl = requireGl();
  const fieldPipeline = requireFieldPipeline();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fieldPipeline.framebuffer);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.readPixels(0, 0, fieldSize, fieldSize, gl.RGBA, gl.FLOAT, renderBuffers.gpuFieldReadback);
  for (let ptr = 0; ptr < fieldCellCount; ptr += 1) {
    targetField[ptr] = renderBuffers.gpuFieldReadback[ptr * 4];
  }
  return true;
}

function readGpuGlowAccumulation(field: Float32Array, colorWeight: Float32Array, colorAccum: Float32Array): boolean {
  if (!gpuFieldPipeline.available) {
    return false;
  }
  const gl = requireGl();
  const fieldPipeline = requireFieldPipeline();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fieldPipeline.framebuffer);

  gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.readPixels(0, 0, fieldSize, fieldSize, gl.RGBA, gl.FLOAT, renderBuffers.gpuFieldReadback);
  for (let ptr = 0; ptr < fieldCellCount; ptr += 1) {
    field[ptr] = renderBuffers.gpuFieldReadback[ptr * 4];
  }

  gl.readBuffer(gl.COLOR_ATTACHMENT1);
  gl.readPixels(0, 0, fieldSize, fieldSize, gl.RGBA, gl.FLOAT, renderBuffers.gpuFieldReadback);
  for (let ptr = 0; ptr < fieldCellCount; ptr += 1) {
    const pixelIndex = ptr * 4;
    colorAccum[ptr * 3] = renderBuffers.gpuFieldReadback[pixelIndex];
    colorAccum[ptr * 3 + 1] = renderBuffers.gpuFieldReadback[pixelIndex + 1];
    colorAccum[ptr * 3 + 2] = renderBuffers.gpuFieldReadback[pixelIndex + 2];
  }

  gl.readBuffer(gl.COLOR_ATTACHMENT2);
  gl.readPixels(0, 0, fieldSize, fieldSize, gl.RGBA, gl.FLOAT, renderBuffers.gpuFieldReadback);
  for (let ptr = 0; ptr < fieldCellCount; ptr += 1) {
    colorWeight[ptr] = renderBuffers.gpuFieldReadback[ptr * 4];
  }

  return true;
}

function shadeFieldOnGpu(params: GpuShadeParams): boolean {
  if (!uploadDitherTexture()) {
    return false;
  }

  const gl = requireGl();
  const fieldPipeline = requireFieldPipeline();
  const shadePipeline = requireShadePipeline();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, glCanvas.width, glCanvas.height);
  gl.useProgram(shadePipeline.program);

  gl.bindBuffer(gl.ARRAY_BUFFER, shadePipeline.positionBuffer);
  gl.enableVertexAttribArray(shadePipeline.attribs.position);
  gl.vertexAttribPointer(shadePipeline.attribs.position, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, fieldPipeline.outputTexture);
  gl.uniform1i(shadePipeline.uniforms.fieldTex, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, fieldPipeline.colorAccumTexture);
  gl.uniform1i(shadePipeline.uniforms.colorAccumTex, 1);

  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, fieldPipeline.colorWeightTexture);
  gl.uniform1i(shadePipeline.uniforms.colorWeightTex, 2);

  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, shadePipeline.ditherTexture);
  gl.uniform1i(shadePipeline.uniforms.ditherTex, 3);

  gl.uniform2f(shadePipeline.uniforms.texel, 1 / fieldSize, 1 / fieldSize);
  gl.uniform1f(shadePipeline.uniforms.displayScale, params.displayScale);
  gl.uniform1f(shadePipeline.uniforms.rms, params.rms);
  gl.uniform1f(shadePipeline.uniforms.centroid, params.centroid);
  gl.uniform1f(shadePipeline.uniforms.contrast, params.contrast);
  gl.uniform1f(shadePipeline.uniforms.coreSharpness, params.coreSharpness);
  gl.uniform1f(shadePipeline.uniforms.haloSharpness, params.haloSharpness);
  gl.uniform1f(shadePipeline.uniforms.lineWeight, params.lineWeight);
  gl.uniform1f(shadePipeline.uniforms.haloWeight, params.haloWeight);
  gl.uniform1f(shadePipeline.uniforms.backgroundWeight, params.backgroundWeight);
  gl.uniform1f(shadePipeline.uniforms.singleAmpGate, params.singleAmpGate);
  gl.uniform1f(shadePipeline.uniforms.separation, params.separation);
  gl.uniform1f(shadePipeline.uniforms.renderDormant, params.renderAsDormantSingle ? 1 : 0);
  gl.uniform1f(shadePipeline.uniforms.shapeMode, state.plateShape === "circle" ? 1 : 0);
  gl.uniform1f(shadePipeline.uniforms.useGlowColor, params.useGlowColor ? 1 : 0);
  gl.uniform1f(shadePipeline.uniforms.glowThickness, params.glowThickness);
  gl.uniform1f(shadePipeline.uniforms.glowSpread, params.glowSpread);
  gl.uniform1f(shadePipeline.uniforms.atmosphereEnabled, params.atmosphereEnabled ? 1 : 0);
  gl.uniform3f(shadePipeline.uniforms.baseBgColor, BASE_BG_COLOR[0], BASE_BG_COLOR[1], BASE_BG_COLOR[2]);
  gl.uniform3f(shadePipeline.uniforms.backdropColor, params.themePalette.backdropColor[0], params.themePalette.backdropColor[1], params.themePalette.backdropColor[2]);
  gl.uniform3f(shadePipeline.uniforms.baseColor, params.themePalette.baseColor[0], params.themePalette.baseColor[1], params.themePalette.baseColor[2]);
  gl.uniform3f(shadePipeline.uniforms.lineColor, params.themePalette.lineColor[0], params.themePalette.lineColor[1], params.themePalette.lineColor[2]);
  gl.uniform3f(shadePipeline.uniforms.outerColor, params.themePalette.outerColor[0], params.themePalette.outerColor[1], params.themePalette.outerColor[2]);
  gl.uniform3f(shadePipeline.uniforms.glowColor, params.glowColor[0], params.glowColor[1], params.glowColor[2]);
  gl.uniform3f(shadePipeline.uniforms.atmosphereCore, params.themePalette.atmosphereCore[0], params.themePalette.atmosphereCore[1], params.themePalette.atmosphereCore[2]);
  gl.uniform3f(shadePipeline.uniforms.atmosphereOuter, params.themePalette.atmosphereOuter[0], params.themePalette.atmosphereOuter[1], params.themePalette.atmosphereOuter[2]);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return true;
}

function setGpuCanvasVisible(visible: boolean, rotateCircleSigned = false): void {
  glCanvas.classList.toggle("is-visible", visible);
  glCanvas.style.transform = rotateCircleSigned ? "rotate(-90deg)" : "";
}

function setGpuCanvasFrame(active: boolean): void {
  if (!active) {
    glCanvas.style.left = "0";
    glCanvas.style.top = "0";
    glCanvas.style.width = "100%";
    glCanvas.style.height = "100%";
    return;
  }
  const stageSize = canvas.clientWidth || glCanvas.parentElement?.clientWidth || 0;
  const inset = stageSize * 0.09;
  const drawSize = stageSize - inset * 2;
  glCanvas.style.left = `${inset}px`;
  glCanvas.style.top = `${inset}px`;
  glCanvas.style.width = `${drawSize}px`;
  glCanvas.style.height = `${drawSize}px`;
}

function setGpuCanvasPresentation(
  active: boolean,
  options: { opacity?: number; blurPx?: number; shadowAlpha?: number } = {},
): void {
  if (!active) {
    glCanvas.style.opacity = "";
    glCanvas.style.filter = "";
    glCanvas.style.boxShadow = "";
    return;
  }
  const opacity = options.opacity ?? 0.18;
  const blur = options.blurPx ?? 0;
  const shadowAlpha = options.shadowAlpha ?? 0.08;
  glCanvas.style.opacity = String(opacity);
  glCanvas.style.filter = blur > 0 ? `blur(${blur.toFixed(2)}px)` : "none";
  glCanvas.style.boxShadow = `0 0 18px rgba(0, 0, 0, ${shadowAlpha})`;
}

function clearGpuPresentation() {
  setGpuCanvasVisible(false, false);
  setGpuCanvasFrame(false);
  setGpuCanvasPresentation(false);
  const gl = gpuFieldPipeline.gl;
  if (!gl) {
    return;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, glCanvas.width, glCanvas.height);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

export {
  clearGpuPresentation,
  readGpuFieldIntoCpuBuffer,
  readGpuGlowAccumulation,
  runGpuFieldAccumulation,
  setGpuCanvasFrame,
  setGpuCanvasPresentation,
  setGpuCanvasVisible,
  shadeFieldOnGpu,
  shouldValidateGpuField,
  validateGpuFieldAgainstCpu,
};
