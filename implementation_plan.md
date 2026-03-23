# 修复 GPU Shade Pipeline 与 CPU 路径线条形状不一致

## 问题描述

当 `canUseGpuFinalShade = true` 时，GPU shade shader 直接从 GPU `outputTexture`（COLOR_ATTACHMENT0）采样场数据。但这份数据是**原始的、未经后处理的**场。

而 CPU 路径在 readback 之后，对 `field` 数组做了 residual / percentile 后处理（第 1761-1784 行），并且 `displayScale` 也是基于后处理后的 `field` 计算的。等高线（isoline）提取也使用后处理后的 `field`。

这导致：
1. GPU shade 的底图渲染的是**未后处理的场**
2. 等高线抽取用的是**后处理后的场**
3. `displayScale` 是后处理后的 maxAbs，但 GPU 纹理里的场值范围不同

即使在默认 `combineMode = "signed"`（不做后处理）下，GPU shade shader 仍然直接从 GPU 纹理采样，**绕过了 CPU readback 的 `field` 数组**。由于 GPU 纹理使用 `RGBA16F`（半精度），而 CPU readback 后是 `float32`，二者的精度差异会导致 `displayScale`（从 CPU field 计算的 maxAbs）与 GPU 纹理实际值之间存在**归一化不匹配**，从而使线条粗细和形状看起来不同。

## 根本原因

[shadeFieldOnGpu](file:///Users/ppp/repos/seesound/audio-reactive-video/web/app.js#891-948) 从 `gpuFieldPipeline.outputTexture` 读数据，而不是从 CPU 后处理过的 `field` 数组。正确做法是：GPU shade 应该消费跟 CPU path 完全相同的数据源——即 readback + 后处理后的 `field` 数组。

## Proposed Changes

### [MODIFY] [app.js](file:///Users/ppp/repos/seesound/audio-reactive-video/web/app.js)

**方案：将后处理后的 field 上传回 GPU 纹理后再做 shade**

在调用 [shadeFieldOnGpu](file:///Users/ppp/repos/seesound/audio-reactive-video/web/app.js#891-948) 之前，把 CPU 上后处理过的 `field`（以及 `colorAccum`/`colorWeight`）写回 GPU 纹理。这样 GPU shade shader 就能读到与 CPU 路径完全一致的数据。

具体改动：

1. **新增函数 `uploadFieldToGpuTexture(field, colorAccum, colorWeight)`**：
   - 将 CPU `field` 数组写入 `gpuFieldPipeline.outputTexture`
   - 将 `colorAccum` 写入 `gpuFieldPipeline.colorAccumTexture`
   - 将 `colorWeight` 写入 `gpuFieldPipeline.colorWeightTexture`

2. **在 [shadeFieldOnGpu](file:///Users/ppp/repos/seesound/audio-reactive-video/web/app.js#891-948) 调用前**（约第 1827 行）：
   - 先调用 `uploadFieldToGpuTexture(field, colorAccum, colorWeight)` 把后处理后的数据同步回 GPU

> [!IMPORTANT]
> 这种方式有一个 round-trip 开销（GPU → CPU readback → 后处理 → CPU → GPU upload → GPU shade），但它保证了 GPU shade 和 CPU shade 看到完全相同的数据。如果你觉得这个 round-trip 不可接受，也可以先把 `canUseGpuFinalShade` 保持 false，仅在未来把后处理逻辑也搬到 GPU 上后再启用。

## Verification Plan

### Manual Verification

1. 打开 [web/index.html](file:///Users/ppp/repos/seesound/audio-reactive-video/web/index.html)，加载一首歌
2. 播放并观察默认 glow 模式的线条形状
3. 在代码里把 `canUseGpuFinalShade` 改为 `false`（CPU 路径），刷新页面，同一首歌同一时刻暂停，截图
4. 改回 `true`（GPU 路径），同样暂停截图
5. 对比两种模式的线条形状是否一致
6. 切换 `combineMode` 为 `residual` 和 [percentile](file:///Users/ppp/repos/seesound/audio-reactive-video/web/app.js#1323-1338)，重复上述对比
