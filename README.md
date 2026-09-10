# dsh-comfy-runner

**DSH（DeepSeek Harness）× ComfyUI 的无人值守跑图系统**：agent 策展提示词空间与 LoRA 配方，runner 整夜执行——零 LLM 依赖、看门狗守夜、断点续跑、账本可复现。

## 它能干什么

- **受控随机池跑图**：服装/场景/姿势/表情/光线/构图多维组合（≈50 万+/角色），相邻冷却、全局去重，"随机但不重复"
- **LoRA 配方 loadout 混抽**：多组画风按权重轮换；可从 ComfyUI Lora 管理器的配方库一键转换新画风（`tools/recipe2loadout.mjs`）
- **主题批次**：自写提示词清单 + 指定画幅（`--prompts-file` + `--ratio 16:9`），一条命令跑整批，缺哪张补哪张（`--skip`）
- **无人值守守卫**：单图超 500s 自动杀 ComfyUI 重启、原种子重试；连续失败熔断；一切可 `--resume`
- **账本**：每张图的种子/提示词/画风/编号全记录，`--seed` 精确复现；`tools/ledger_repair.mjs` 从 ComfyUI history 对账体检
- **并发锁**：多会话/多进程互踩账本？直接拦下

## 快速开始（朋友向）

需要：Windows + [Node.js ≥20](https://nodejs.org) + 一套能跑 **Krea2** 的 ComfyUI（含自定义节点，见下方依赖）

```powershell
git clone https://github.com/libolunm/auto-paotu-1.0.git
cd dsh-comfy-runner
copy config.example.json config.json   # 编辑：填你的 ComfyUI python.exe 和目录
node runner.mjs --n 2 --show           # 干跑：看提示词（不生成）
node runner.mjs --n 2 --keep-going     # 真跑两张试试
```

想让它成为 DSH agent 的技能（推荐）：把仓库里 `agent-skill\` 目录加进你预设的 `customSkillDirs`，新会话 agent 就自带全部操作知识。

**模型与自定义节点依赖**（缺了会 submit 报错）：
- UNET `krea2\krea2_turbo_int8_convrot.safetensors`、CLIP `qwen3vl_4b_fp8_scaled.safetensors`、VAE `qwen_image_vae.safetensors`、放大 `2x-AnimeSharpV4_RCAN`
- 自定义节点：Lora Manager（含 Lora Loader/Prompt/TriggerWord Toggle）、FLS_SamplerV4、AnimaBoosterLoader、AnimaTeaCache、easy cleanGpuUsed、Krea2ProjectorTuner、ImageSharpen 等
- `workflows\` 里各 loadout 的 LoRA 清单见同名 `.meta.json`（从 Lora 管理器配方库可搜到同名配方）

---

# 使用手册（作者本机版）

角色：白发金瞳狐耳天使（foxangel）。目录：`D:\deepseekharness\预设与酒馆\dsh-comfy-runner\`

## 一、出门前（核心用法）

```powershell
cd D:\deepseekharness\预设与酒馆\dsh-comfy-runner
node runner.mjs --n 50 --keep-going
```

- 50 张，8 个画风 loadout 加权混抽，组合空间约 500 万，不重复
- 看门狗：单图超 500s → 自动重启 ComfyUI → 原种子重试（最多 3 次）；连续 3 张彻底失败 → 自动停
- ComfyUI 没开也会自动拉起；终端别关（挂后台/锁屏都行）
- 想先看提示词再跑：`node runner.mjs --n 50 --show`（干跑，不写账本）
- 中断了续跑：`node runner.mjs --resume`
- **并发锁**：同时只允许一个 runner（`runs\runner.lock`）；报 exit 5 = 有别的在跑，等它或 `--resume` 接手

## 一.5、主题批次（指定画风 + 自写提示词 + 画幅）

```powershell
# 1. 提示词文件（agent 写）：runs\youyuan-prompts.txt，按块分：
#    ===== PROMPT 01 =====
#    <完整提示词>
#    ===== PROMPT 02 =====
#    ...
# 2. 一条命令跑完整批：
node runner.mjs --prompts-file runs\youyuan-prompts.txt --loadout recipe-ff240675 --ratio 16:9 --keep-going
# 3. 部分完成后补缺（跳过已出图的编号）：
node runner.mjs --prompts-file runs\youyuan-prompts.txt --loadout recipe-ff240675 --ratio 16:9 --skip "1,3" --keep-going
```

- 画幅：`--ratio 16:9`（`--mp 1.3` 调像素量）或 `--size 1536x864`；运行时写进工作流，**不需要复制工作流文件**
- 中断续跑同样是 `--resume`
- 每张图在账本里带 `promptNo`（对应提示词块编号），早上按编号对图

## 二、回来看结果

- **图片**：`runs\images\`（同时存 ComfyUI 的 `E:\woyao\output\dsh_foxangel\`）
- **账本**：`runs\runs.json` —— `runs[]` 每张图的种子、画风、完整提示词、编号；`batches[]` 最近 30 批归档
- **对账体检**（哪些图缺记录/缺本地文件）：`node tools/ledger_repair.mjs`（干跑只报告；`--apply --download-missing` 修复）
- 翻账本快捷方式：
  ```powershell
  node -e "const l=require('./runs/runs.json');l.runs.forEach(r=>console.log(r.ok?'OK':'FAIL',r.ts,r.loadout,r.promptNo??r.batchId,r.seed,r.images[0]?.local||r.error))"
  ```

## 三、复现喜欢的那张

从账本找到它 → 用相同 loadout + 提示词 + 种子重跑：

```powershell
node runner.mjs --n 1 --loadout recipe-ff240675 --seed 45076377040705 --prompt "<账本里的完整prompt>"
```

改种子数字就能同一构图微调，或同提示词换 seed 抽卡。

## 四、加新 LoRA 配方（Lora 管理器联动）

1. 在 ComfyUI 的 Lora 管理器里收藏/导入新配方（civitai 图拖进去即可）
2. 跟 agent 说「策展一下新配方」，或自己动手：
   ```powershell
   node tools/recipes_list.mjs --force          # 拉清单（只列 Krea2 且文件齐全的）
   node tools/recipe2loadout.mjs --recipe <id前缀> --trigger "触发词" --lead "引导短语" --weight 1
   node runner.mjs --n 1 --loadout recipe-<id> --prompt "masterpiece, ... 短提示"   # smoke test
   ```
3. 删除某个画风：删掉 `workflows\recipe-*.json` 和同名 `.meta.json`

触发词复核要点：优先抄配方原 prompt 开头的质量词/画风词；`--lead` 是给自然语言主句的引导（如 `a cinematic photograph of`）。

## 五、改角色 / 改方向

- 改 `lib\character.mjs`：`CHARACTER.anchors`（锚点标签，每张固定）、`intro`（主句）、各维度池
- **换角色必须把 `POOL_VERSION` 改成新值**（账本去重才不会串）
- 池子条目双编码：`t` = danbooru 标签，`p` = 自然语言短语
- 提示词写法规范见 `skills\krea2-prompt.md`（krea2 规则 + NSFW 词汇表 + 格式基准）

## 六、Loadout 阵容与权重

`workflows\` 下每个 json = 一个画风。当前 8 个：

| id | 画风 | 权重 |
|---|---|---|
| recipe-ff240675 | 汉服梦织古风 | 1.5 |
| gufeng-sora72 | sora72 画师古风 | 1.5 |
| recipe-a74fdd0c | 巨乳增强厚涂 | 1.2 |
| 3d-fugtrup / recipe-8b0f87e7 / recipe-2978cca0 | 3D / 暗黑浪漫 / 半写实 | 1.0 |
| recipe-eb8e90b7 | 怀旧动漫 | 0.8 |
| recipe-58065daa | SFW 童话插画 | 0.6 |

权重改法：编辑 `workflows\<id>.meta.json` 的 `weight` 字段（或 `lib\loadouts.mjs` 的 OVERRIDES，后者优先）。

## 七、配置与排障

`config.json`：`watchdogMs`（500s）、`maxRestartsPerImage`、`maxConsecutiveFailures`、ComfyUI 启动命令。

| 症状 | 处理 |
|---|---|
| exit 5（another runner is active） | 有别的 runner 在跑。等它跑完 `--resume` 接手，**别并行** |
| ledger is corrupt | `node tools/ledger_repair.mjs --apply --download-missing` 从 ComfyUI history 重建 |
| 提示 `no loadouts found` | `workflows\` 空了，重新转换或还原 |
| 提交被拒 submit 错误 | 工作流节点号变了（重新导出 API 流后核对 #18/#201/#1535） |
| 看门狗反复重启仍失败 | 看 `E:\woyao\user\default\comfy.log`；常见是 LoRA 文件被挪走/显存不足 |
| 想临时测看门狗 | `--watchdog-ms 15000` 跑一张看重启链路 |

环境注意：本机没有 pwsh.exe（只有 Windows PowerShell 5.1）；JSON 用 node 处理，别用 PS 内联。

## 八、速度参考

模型在显存时单张约 2.5 分钟（含 2x RCAN 放大）；冷启动首张 5-9 分钟。每小时约 24 张，一晚 150-250 张。
