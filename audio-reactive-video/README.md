# audio-reactive-video

## 简介

一个本地命令行工具：读取音频文件，先做逐帧音频分析，再用程序化视觉生成极简暗色 techno 风格画面，最终导出带原始音频的 MP4 视频。

当前版本是 MVP，包含：

- 音频分析脚本，输出 `analysis.json`
- 一个 dark techno 极简主题
- 一个 black/white star-line 极简主题
- 一个 black/white star-line 频谱映射主题
- 一个从左右向中心汇聚的 wireframe 频谱主题
- 一个单脊线历史堆叠的 wireframe 频谱主题
- 一个离散脉冲从左右向中间发射并叠加的 wireframe 主题
- 一组面向“直接表达声音”的 signal-driven 可视化设计文档
- 一个用于快速试验共振场映射的 Web 实时预览器
- 命令行导出逐帧 PNG 和最终 MP4
- 可扩展的主题接口，方便后续新增 `fluid`、`geometry` 等风格

## 目录结构

```text
.
├── README.md
├── requirements.txt
├── config.default.json
├── bin/
│   └── audio-reactive-video
├── docs/
│   ├── ARCHITECTURE.md
│   ├── SIGNAL_DRIVEN_VISUALIZATION.md
│   ├── THEME_STAR_LINE_MINIMAL.md
│   ├── THEME_STAR_LINE_SPECTRUM.md
│   ├── THEME_WIREFRAME_INBOUND.md
│   ├── THEME_WIREFRAME_PULSES.md
│   ├── THEME_WIREFRAME_RIDGE.md
│   └── THEME_WIREFRAME_WAVEFRONT.md
├── examples/
│   ├── config.star-line.json
│   ├── config.star-line-spectrum.json
│   ├── config.wireframe-inbound.json
│   ├── config.wireframe-pulses.json
│   ├── config.wireframe-ridge.json
│   ├── config.wireframe-wavefront.json
│   └── config.techno.json
└── src/
    └── arv/
        ├── analysis.py
        ├── cli.py
        ├── config.py
        ├── export.py
        ├── smoothing.py
        ├── themes/
        └── render/
```

## 依赖

运行需要：

- Python 3.11+
- `ffmpeg`
- Python 包：
  - `numpy`
  - `librosa`
  - `Pillow`
  - `soundfile`

安装示例：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r audio-reactive-video/requirements.txt
```

确认 `ffmpeg` 可用：

```bash
ffmpeg -version
```

## 快速开始

启动 Web 实时预览器：

```bash
python -m arv.cli web-preview --host 127.0.0.1 --port 8765
```

然后在浏览器打开 `http://127.0.0.1:8765`。

单命令导出完整视频：

```bash
audio-reactive-video/bin/audio-reactive-video export \
  --input /path/to/music.mp3 \
  --output /path/to/output.mp4 \
  --config audio-reactive-video/config.default.json \
  --workers 4
```

分步执行：

```bash
audio-reactive-video/bin/audio-reactive-video analyze \
  --input /path/to/music.mp3 \
  --output /tmp/analysis.json

audio-reactive-video/bin/audio-reactive-video render \
  --analysis /tmp/analysis.json \
  --frames-dir /tmp/arv-frames \
  --config audio-reactive-video/config.default.json \
  --workers 4

audio-reactive-video/bin/audio-reactive-video mux \
  --frames-dir /tmp/arv-frames \
  --audio /path/to/music.mp3 \
  --output /path/to/output.mp4 \
  --fps 60
```

## 输出内容

- `analysis.json`
  - 每帧 RMS
  - 低/中/高频能量
  - spectral centroid
  - onset / beat
  - 32 或 64 个 log-scale 频带
  - 左右声道的 RMS、low/mid/high、centroid 和频带
  - 左右声道的短时原始波形窗口
  - 平滑后的特征
- 逐帧 PNG
- 最终 MP4

## 进度与性能

- 控制台会输出分析、状态预计算、逐帧渲染、mux 四个阶段的进度
- `--workers N` 可开启多进程并行渲染；`1` 表示单进程
- 建议先用 `--workers 4` 或 `--workers 6` 试跑，再根据 CPU 和内存占用调整
- 当前 techno 主题已经收敛了元素数量，默认比早期版本更克制

## 默认视觉风格

- 黑色背景
- 居中的极坐标抽象有机形状
- bass 驱动整体脉冲和扩张
- mid 驱动主体轮廓形变
- treble 驱动边缘噪声和微闪烁
- beat 触发局部冲击波、粒子和亮度提升
- 轻量后期：bloom、grain、vignette、blur

## 其他主题

- `techno_minimal`：暗色 techno 抽象形变
- `star_line_minimal`：纯黑背景、白色四芒星、左右立体声延伸线
- `star_line_spectrum`：真实频谱包络压进四芒星几何
- `wireframe_inbound`：左右边缘不断向中心输送波形的多层线框频谱
- `wireframe_pulses`：左右边缘离散脉冲向中间发射并在中心叠加的线框主题
- `wireframe_ridge`：单脊线加历史轮廓堆叠的线框频谱
- `wireframe_wavefront`：基于原始时域波形块向中间传播的 signal-driven 线框主题

规格文档：
- [THEME_STAR_LINE_MINIMAL.md](/Users/ppp/repos/hammer/audio-reactive-video/docs/THEME_STAR_LINE_MINIMAL.md)
- [THEME_STAR_LINE_SPECTRUM.md](/Users/ppp/repos/hammer/audio-reactive-video/docs/THEME_STAR_LINE_SPECTRUM.md)
- [THEME_WIREFRAME_INBOUND.md](/Users/ppp/repos/hammer/audio-reactive-video/docs/THEME_WIREFRAME_INBOUND.md)
- [THEME_WIREFRAME_PULSES.md](/Users/ppp/repos/hammer/audio-reactive-video/docs/THEME_WIREFRAME_PULSES.md)
- [THEME_WIREFRAME_RIDGE.md](/Users/ppp/repos/hammer/audio-reactive-video/docs/THEME_WIREFRAME_RIDGE.md)
- [THEME_WIREFRAME_WAVEFRONT.md](/Users/ppp/repos/hammer/audio-reactive-video/docs/THEME_WIREFRAME_WAVEFRONT.md)
- [SIGNAL_DRIVEN_VISUALIZATION.md](/Users/ppp/repos/hammer/audio-reactive-video/docs/SIGNAL_DRIVEN_VISUALIZATION.md)

## 配置

默认配置见 [config.default.json](/Users/ppp/repos/hammer/audio-reactive-video/config.default.json)，可复制后修改：

```bash
cp audio-reactive-video/config.default.json /tmp/arv-config.json
```

## 主题扩展

主题通过注册表加载，后续增加新风格时只需要：

1. 在 `src/arv/themes/` 下新增主题类
2. 在 `src/arv/themes/__init__.py` 注册
3. 在配置里切换 `theme.name`

## 当前限制

- 本仓库当前未内置第三方依赖，需要先安装 `requirements.txt`
- 视频合成依赖本机已安装 `ffmpeg`
- 当前主题以 1080p/60fps 为目标，但更高分辨率会明显增加渲染时间
