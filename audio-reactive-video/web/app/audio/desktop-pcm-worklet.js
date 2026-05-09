class DesktopPcmBridgeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.readOffset = 0;
    this.maxQueuedChunks = 4;

    this.port.onmessage = (event) => {
      const message = event.data;
      if (!message || typeof message !== "object") {
        return;
      }
      if (message.type === "push" && message.samples) {
        const chunk = message.samples instanceof Float32Array
          ? message.samples
          : new Float32Array(message.samples);
        if (chunk.length > 0) {
          this.queue.push(chunk);
          if (this.queue.length > this.maxQueuedChunks) {
            const keepFrom = Math.max(0, this.queue.length - this.maxQueuedChunks);
            this.queue = this.queue.slice(keepFrom);
            this.readOffset = 0;
          }
        }
        return;
      }
      if (message.type === "reset") {
        this.queue.length = 0;
        this.readOffset = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) {
      return true;
    }

    const channel = output[0];
    channel.fill(0);

    let writeIndex = 0;
    while (writeIndex < channel.length && this.queue.length > 0) {
      const chunk = this.queue[0];
      const remaining = chunk.length - this.readOffset;
      const copyLength = Math.min(channel.length - writeIndex, remaining);
      channel.set(chunk.subarray(this.readOffset, this.readOffset + copyLength), writeIndex);
      writeIndex += copyLength;
      this.readOffset += copyLength;
      if (this.readOffset >= chunk.length) {
        this.queue.shift();
        this.readOffset = 0;
      }
    }

    return true;
  }
}

registerProcessor("desktop-pcm-bridge", DesktopPcmBridgeProcessor);
