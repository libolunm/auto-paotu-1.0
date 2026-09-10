# 自动化跑图 1.0

Windows 上运行的 Krea2 × ComfyUI 批量生图工具。它把提示词组合、LoRA loadout、批量提交、看门狗、断点续跑和结果账本放进一个可复用的项目里。

这个仓库包含两部分：

- `runner.mjs`：实际执行 ComfyUI API 工作流的 Node.js runner。
- `agent-skill/dsh-comfy-runner/SKILL.md`：给 DSH/Codex 类 agent 使用的操作规范，让 agent 能把中文需求转换成批次、提示词文件和 runner 命令。

它可以单独作为命令行工具使用，也可以作为 DSH agent 的技能挂载。agent 集成不是运行工具的必要条件。

## 功能

- **随机池批次**：从服装、场景、姿势、表情、构图和光线等维度组合提示词。
- **LoRA loadout**：每个 `workflows/*.json` 是一组可抽取的 API 工作流，可通过 `.meta.json` 设置权重和元数据。
- **主题批次**：使用 `===== PROMPT NN =====` 分块文件，一条命令运行一组固定提示词。
- **运行时改画布**：用 `--ratio` 或 `--size` 修改 EmptyLatentImage 尺寸，不需要为每个比例复制工作流。
- **无人值守恢复**：单张图超时后重启 ComfyUI，并用相同种子重试；连续失败达到阈值后熔断。
- **断点续跑**：批次计划和每张图的状态都会写入账本，可用 `--resume` 继续未完成任务。
- **运行锁**：提供 `runs/runner.lock` 冲突检测；当前版本仍要求手动保证单实例运行，详见下方已知限制。
- **可复现记录**：账本保存 seed、prompt、loadout、批次、文件名和错误信息。
- **历史修复**：`tools/ledger_repair.mjs` 可以从 ComfyUI `/history` 找回因中断或旧版本并发造成的记录缺口。

## 当前范围

本项目目前面向 **Windows + Node.js + ComfyUI API 工作流**。看门狗依赖 Windows 的 `netstat` 和 `taskkill`，Linux/macOS 需要另写进程管理实现。

工作流和模型属于运行环境的一部分。本仓库提供示例 loadout 和节点参数结构，但不会下载 ComfyUI、自定义节点、基础模型或 LoRA 文件。

## 安装

### 1. 克隆仓库

```powershell
git clone https://github.com/libolunm/auto-paotu-1.0.git
cd auto-paotu-1.0
```

### 2. 准备运行环境

推荐安装 [Node.js 24](https://nodejs.org/)（当前验证版本）。代码使用 `import.meta.dirname`，至少需要 Node.js 20.11；不支持早期 Node.js 20 版本。本项目不需要 `npm install`；runner 只使用 Node.js 内置模块和仓库内的 `.mjs` 文件。

准备一套能通过 `http://127.0.0.1:8188` 提供 API 的 ComfyUI，并确认它可以单独运行一个目标工作流。

### 3. 配置 ComfyUI 路径

复制配置模板：

```powershell
Copy-Item config.example.json config.json
```

编辑 `config.json` 中的 `comfy.exe` 和 `comfy.cwd`。路径必须指向你自己的 ComfyUI Python 可执行文件和 ComfyUI 根目录。`config.json` 已被 `.gitignore` 排除，不会被提交。

如果 ComfyUI 已经手动启动，runner 只需要访问 `base` 地址；如果希望 runner 在 ComfyUI 无响应时自动启动，必须正确填写 `comfy` 配置。

### 4. 安装模型和自定义节点

具体文件名取决于你的工作流。当前示例 loadout 使用的环境包括：

- Krea2 UNET：`krea2/krea2_turbo_int8_convrot.safetensors`
- Qwen3-VL CLIP：`qwen3vl_4b_fp8_scaled.safetensors`
- Qwen Image VAE：`qwen_image_vae.safetensors`
- 放大模型：`2x-AnimeSharpV4_RCAN`
- Lora Manager 节点
- `FLS_SamplerV4`
- `Krea2ProjectorTuner`
- `AnimaBoosterLoader`、`AnimaTeaCache`
- `easy cleanGpuUsed`、`ImageSharpen` 等工作流中引用的节点

请用 ComfyUI 的实际节点名称和模型目录校验这些依赖。缺少节点或模型时，ComfyUI 会在提交阶段拒绝工作流。

## 第一次验证

先只查看计划和提示词，不会提交任务，也不会写入账本：

```powershell
node runner.mjs --n 2 --show
```

确认输出正常后运行两张测试图：

```powershell
node runner.mjs --n 2 --keep-going
```

生成的本地图片会保存到 `runs/images/`。运行记录会保存到 `runs/runs.json`。这些目录是个人运行数据，默认不会进入 Git。

也可以双击 `跑图.bat`，它会询问新批次数量或是否从中断批次续跑。

## 常用命令

### 随机池批次

```powershell
node runner.mjs --n 20 --keep-going
```

指定一个 loadout：

```powershell
node runner.mjs --n 5 --loadout recipe-ff240675 --keep-going
```

指定种子和提示词复现一张图：

```powershell
node runner.mjs --n 1 --loadout recipe-ff240675 --seed 45076377040705 --prompt "your prompt"
```

### 主题批次

提示词文件格式如下：

```text
===== PROMPT 01 =====
A complete prompt for image 1.

===== PROMPT 02 =====
A complete prompt for image 2.
```

一条命令运行整批：

```powershell
node runner.mjs `
  --prompts-file runs\theme-prompts.txt `
  --loadout recipe-ff240675 `
  --ratio 16:9 `
  --keep-going
```

只补跑缺失编号，例如跳过已经完成的 1 和 3：

```powershell
node runner.mjs `
  --prompts-file runs\theme-prompts.txt `
  --loadout recipe-ff240675 `
  --size 1536x864 `
  --skip "1,3" `
  --keep-going
```

`--ratio 16:9` 默认按约 1.3MP 计算尺寸，可以用 `--mp` 调整目标像素量。需要和已有图片完全一致时，使用 `--size WxH`。

### 续跑、检查和修复

从 active batch 继续：

```powershell
node runner.mjs --resume --keep-going
```

检查 ComfyUI history 与本地账本：

```powershell
node tools/ledger_repair.mjs
```

确认报告无误后，才写回账本：

```powershell
node tools/ledger_repair.mjs --apply
```

如果本地图片也缺失，同时从 ComfyUI 输出接口下载：

```powershell
node tools/ledger_repair.mjs --apply --download-missing
```

## Agent skill 集成

仓库中的 `agent-skill/dsh-comfy-runner/` 是一个独立技能目录。它描述了：

- 中文跑图请求如何路由到本工具。
- 随机池和主题批次如何规划。
- Krea2 提示词的固定结构和角色锚点处理。
- 配方转换、loadout 权重和 smoke test 流程。
- 并发锁、账本、续跑和故障修复规则。

### DSH/Codex 类环境

把 `agent-skill` 目录加入你的 agent preset 的 `customSkillDirs`，然后新开一个会话。目录布局应保持为：

```text
<your-clone>/
└── agent-skill/
    └── dsh-comfy-runner/
        └── SKILL.md
```

技能文件会根据自身位置把仓库根目录识别为 `<your-clone>`。如果你的宿主环境不支持 `customSkillDirs`，仍然可以直接运行 `runner.mjs`；技能只是自动化操作层，不是 runner 的依赖。

## 项目结构

```text
runner.mjs                         # 批次执行入口
config.example.json                # 配置模板
跑图.bat                            # Windows 双击入口
lib/
  character.mjs                    # 角色锚点、提示词维度池和组合逻辑
  loadouts.mjs                     # loadout 发现、元数据和权重
  comfy.mjs                        # ComfyUI API 客户端
  watchdog.mjs                     # Windows 看门狗与重启
  recipes.mjs                      # Lora Manager 配方接口
workflows/                          # API 工作流和 loadout sidecar
skills/krea2-prompt.md             # Krea2 提示词规范
agent-skill/dsh-comfy-runner/       # 可挂载的 agent skill
tools/
  recipe2loadout.mjs                # 配方转换
  recipes_list.mjs                  # 配方清单
  ledger_repair.mjs                 # history 对账和账本修复
  wf_inspect.mjs                    # UI 工作流检查
runs/                               # 本地运行数据，不入 Git
cache/                              # 本地缓存，不入 Git
```

## 账本和并发模型

`runs/runs.json` 使用 v3 结构。当前 `saveLedger()` 是直接写入；不要在同一目录启动多个 runner，也不要在 runner 工作时手工编辑账本：

- `runs[]`：每张图的追加记录。
- `activeBatch`：当前可续跑批次。
- `batches[]`：已完成批次的计划归档，保留最近 30 批。
- `usedCombos[]`：随机组合去重键。

同一个项目目录只应同时运行一个 runner。当前锁文件由 runner 在批次计划写入后创建；两个 runner 不应并行启动，外部脚本直接调用 ComfyUI API 也不会受此保护。

### 当前版本的使用限制

- **续跑只处理 `pending`**：`failed` 不会自动重试。没有可续跑的 active batch 时，`--resume` 会进入新批次规划；先用 `--resume --show` 检查计划，确认输出包含 `resuming`。
- **画幅需再次传入**：画幅覆盖尚未保存在批次计划里。续跑横版批次时，请再次传入原来的 `--size` 或 `--ratio` 参数。
- **归档不是任意批次恢复入口**：`batches[]` 保存历史计划，但当前没有按 batch ID 恢复归档的 CLI 参数。开始新批次前先处理现有未完成任务。
- **修复工具不是完整备份工具**：它要求现有账本是可解析的 JSON，只追加 history 中缺失的记录；不会修复损坏 JSON，也不会重新下载已被判定为重复记录的图片。操作前备份账本，并确认 ComfyUI history 尚有对应记录。
- **看门狗会终止进程树**：恢复流程会强制停止本机目标端口对应的进程及其子进程。请使用专用的本地 ComfyUI 实例，不要让其他任务共用它，也不要把远程 API 当作完整支持的看门狗场景。
- **示例不是通用默认配置**：随机池内置角色与成人向提示词；使用前先检查 `lib/character.mjs`，或用显式提示词模式。示例模型、LoRA 和节点必须由使用者自行安装。

这些限制也适用于 agent 自动执行。相同 seed 只用于尽量复现；模型、节点版本、工作流、尺寸或硬件变化都可能改变结果。

## 添加或调整 loadout

将 ComfyUI API 格式工作流放入 `workflows/`。runner 会检查以下参数节点是否存在：

- `#18`：Prompt 文本。
- `#201`：采样器 seed。
- `#1535`：保存文件名前缀。
- `#12`：使用 `--ratio` 或 `--size` 时需要是 `EmptyLatentImage`。

可以为工作流添加同名 `.meta.json`，设置触发词、引导短语、质量尾巴和抽取权重。修改后先用一张图做 smoke test，再加入夜间批次。

如果使用 Lora Manager 配方工具：

```powershell
node tools/recipes_list.mjs --force
node tools/recipe2loadout.mjs --recipe <id-prefix> --trigger "trigger words" --lead "guidance phrase" --weight 1
node runner.mjs --n 1 --loadout recipe-<id> --prompt "short smoke-test prompt"
```

## 故障排查

| 现象 | 处理 |
|---|---|
| `no loadouts found` | 检查 `workflows/` 是否有有效 API 工作流，以及是否包含 `#18/#201/#1535`。 |
| `another runner is active` / exit 5 | 等已有 runner 完成；确认它退出后使用 `--resume`。不要并行启动第二个 runner。 |
| `ledger is corrupt` | 停止写入并保留原文件，先从备份恢复或修复 JSON；修复工具不能读取损坏 JSON，只有账本可解析后才能对账。 |
| ComfyUI 无法自动启动 | 手动启动 ComfyUI，或检查 `config.json` 中的 `comfy.exe`、`args` 和 `cwd`。 |
| submit 阶段被拒 | 检查缺失的自定义节点、模型文件和参数节点；可用 `tools/wf_inspect.mjs` 检查 UI 工作流。 |
| 看门狗多次重启 | 查看 ComfyUI 日志，确认显存、LoRA 路径和自定义节点状态。 |
| 主题批次只完成一部分 | 使用 `--resume`，或根据已有编号使用 `--skip` 补跑。 |

本机环境如果只有 Windows PowerShell 5.1，请避免使用三元运算符、`??` 和复杂的内联 PowerShell JSON 操作；复杂修复优先写成 Node.js `.mjs` 脚本。

## 贡献

欢迎提交：

- 新的 ComfyUI 工作流兼容性修复。
- 新的节点或模型适配。
- Windows 以外的平台支持。
- 更可靠的账本迁移和测试。
- 不包含个人路径、运行图片、私有配置或模型文件的文档改进。

提交问题时请附上：Node.js 版本、ComfyUI 版本、错误阶段（`submit` / `wait` / `download`）、相关工作流节点信息和去除隐私后的日志片段。不要上传 `config.json`、`runs/` 或包含个人路径的完整日志。

## 许可

代码和文档按 [MIT License](LICENSE) 发布。模型、LoRA、自定义节点以及第三方工作流各自遵循其原始许可证；本仓库不重新授权这些外部资源。

## 中文简介

这是一个给 ComfyUI Krea2 工作流使用的 Windows 批量跑图工具。你可以直接用命令行跑随机池，也可以准备一份主题提示词文件后一次运行整批。runner 会记录 seed、提示词、loadout 和图片路径，遇到超时可以自动重启 ComfyUI，遇到中断可以续跑。仓库还提供一个 DSH agent skill，让 agent 代替用户处理提示词、配方、批次和故障恢复。
