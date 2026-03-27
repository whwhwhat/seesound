declare global {
  interface GPUAdapter {
    requestDevice(): Promise<GPUDevice>;
  }

  interface GPUDevice {
    queue: {
      writeTexture(destination: object, data: ArrayBufferLike | ArrayBufferView<ArrayBufferLike>, dataLayout: object, size: object): void;
      writeBuffer(buffer: GPUBuffer, offset: number, data: ArrayBufferLike | ArrayBufferView<ArrayBufferLike>): void;
      submit(commandBuffers: object[]): void;
    };
    createShaderModule(descriptor: { code: string }): GPUShaderModule;
    createTexture(descriptor: object): GPUTexture;
    createBuffer(descriptor: object): GPUBuffer;
    createSampler(descriptor: object): GPUSampler;
    createRenderPipeline(descriptor: object): GPURenderPipeline;
    createComputePipeline(descriptor: object): GPUComputePipeline;
    createBindGroup(descriptor: object): object;
    createCommandEncoder(): GPUCommandEncoder;
  }

  interface GPUCanvasContext {
    configure(descriptor: object): void;
    getCurrentTexture(): GPUTexture;
  }

  interface GPUTexture {
    createView(descriptor?: object): GPUTextureView;
  }

  interface GPUBuffer {}
  interface GPUBuffer {
    mapAsync(mode: number): Promise<void>;
    getMappedRange(offset?: number, size?: number): ArrayBuffer;
    unmap(): void;
  }

  interface GPUSampler {}

  interface GPUShaderModule {}

  interface GPURenderPipeline {
    getBindGroupLayout(index: number): object;
  }

  interface GPUComputePipeline {
    getBindGroupLayout(index: number): object;
  }

  interface GPUTextureView {}

  interface GPUCommandEncoder {
    beginRenderPass(descriptor: object): {
      setPipeline(pipeline: object): void;
      setBindGroup(index: number, bindGroup: object): void;
      draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void;
      end(): void;
    };
    beginComputePass(): {
      setPipeline(pipeline: object): void;
      setBindGroup(index: number, bindGroup: object): void;
      dispatchWorkgroups(x: number, y?: number, z?: number): void;
      end(): void;
    };
    copyTextureToBuffer(source: object, destination: object, copySize: object): void;
    copyBufferToBuffer(source: GPUBuffer, sourceOffset: number, destination: GPUBuffer, destinationOffset: number, size: number): void;
    finish(): object;
  }

  interface Navigator {
    gpu?: {
      requestAdapter(options?: object): Promise<GPUAdapter | null>;
      getPreferredCanvasFormat?(): string;
    };
  }

  const GPUTextureUsage: {
    RENDER_ATTACHMENT: number;
    TEXTURE_BINDING: number;
    COPY_DST: number;
    COPY_SRC: number;
  };
  const GPUBufferUsage: {
    STORAGE: number;
    COPY_DST: number;
    COPY_SRC: number;
    UNIFORM: number;
    MAP_READ: number;
  };
  const GPUMapMode: {
    READ: number;
  };
}

export {};
