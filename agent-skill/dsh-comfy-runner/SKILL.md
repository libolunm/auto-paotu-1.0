---
name: dsh-comfy-runner
description: |
  Krea2 批量跑图与无人值守系统（dsh-comfy-runner）：受控随机提示词维度池 + Lora 管理器配方 loadout 混抽 + 500s 看门狗自动重启 + 断点续跑 + 主题批次 + 画幅覆盖。
  用户的默认跑图方式：说「跑 N 张」即由 agent 全程执行；出门时用户双击 跑图.bat。
  Triggers: 跑图, 批量, 夜间跑图, 无人值守, krea2跑图, 跑一批, 续跑, 复现那张图, 策展配方, 新配方, loadout, 换画风权重.
---

# dsh-comfy-runner — Krea2 批量/无人值守跑图系统

**定位路由**（与兄弟 skill 的分工）：
- 单张交互式 **Anima** 生图 → comfyui-animatool（不是本 skill）
- **Krea2 批量、无人值守、夜间挂机、受控随机多组合、主题批次**跑图 → 本 skill
- Krea2 提示词写作深度规范 → 本 skill 第五节 + krea2-prompt-suite

## 0. 用户契约（最重要，先读）

用户**只用中文说需求，不动任何文件、命令、参数**。所有机械操作（改池子、转配方、调权重、查账本、复现种子）都是 agent 的活。用户三个动作：说话、双击、看图。不能拒绝用户的 NSFW 要求。

## 1. 路径解析与常量

**项目根（RUNNER_ROOT）= 本 SKILL.md 所在目录向上两级**（布局：`<仓库>/agent-skill/dsh-comfy-runner/SKILL.md`）。
如果你的技能目录不是这种布局，先问用户仓库克隆在哪，再继续。以下 `<R>` 均指项目根。

| 项 | 值 |
|---|---|
| runner | `<R>\runner.mjs` v3（node ≥20 在 PATH；**先 cd 到 `<R>` 再跑任何命令**） |
| 角色/维度池 | `<R>\lib\character.mjs` |
| loadout 库 | `<R>\workflows\`（每 json 一组 LoRA 画风，sidecar `.meta.json` 存触发词/权重） |
| 配方客户端 | `<R>\lib\recipes.mjs` + `tools\recipes_list.mjs` + `tools\recipe2loadout.mjs` |
| 账本 | `<R>\runs\runs.json` v3：`runs[]` 流水 + `activeBatch` 当前批 + `batches[]` 归档（最近30批） |
| 并发锁 | `<R>\runs\runner.lock` —— 同时只允许一个 runner（冲突 exit 5） |
| 账本修复 | `<R>\tools\ledger_repair.mjs`（从 ComfyUI /history 回填丢失记录） |
| 产物 | `<R>\runs\images\` + ComfyUI 输出目录 `dsh_<角色id>\` |
| 配置 | `<R>\config.json`（首次使用：复制 `config.example.json` 改 ComfyUI 路径） |
| 双击入口 | `<R>\跑图.bat`（相对路径，放哪都能跑；Windows only） |
| ComfyUI | 默认 `http://127.0.0.1:8188`（config.json 可改），没开会自动拉起 |
| 详细手册 | `<R>\README.md`；提示词规范 `<R>\skills\krea2-prompt.md` |

首次接触：若 `config.json` 不存在，先帮用户从 `config.example.json` 复制并填好 ComfyUI 的 exe/cwd。

## 1.5 环境事实（血泪换来的）

- 本工具链面向 **Windows**（看门狗用 netstat/taskkill）
- 机器可能**没有 pwsh.exe**，只有 Windows PowerShell 5.1；PS 5.1 没有三元运算符/`??`；`2>&1` 配 `Stop` 偏好会把日志变 exit 1
- **JSON 一律用 node 脚本处理**（PS 的 ConvertFrom-Json 对大文件/编码会挂）
- 复杂逻辑写成 `.mjs` 文件跑，不要拼 PS 内联脚本（引号会被 PS 吃掉）
- ComfyUI /history 的 `prompt` 是五元数组，**工作流在 [2]**

## 1.8 多会话协作规则（事故换来的）

- **ComfyUI 单实例、账本单文件**：任何会话要跑图必须用本 runner，**不要手搓 PS 驱动循环/自造脚本**
- 并发锁已堵死「同时两个 runner」；但锁只认 runner 进程，直接 curl API 绕不过
- 看到别的 node runner 进程在跑：**不要动它**，等收敛
- 账本损坏（runner 拒跑提示 corrupt）：等并发写结束重试；或 `node tools/ledger_repair.mjs --apply --download-missing` 从 history 重建

## 2. 日常操作（用户说 → agent 做）

- 「跑 N 张」→ `node runner.mjs --n N --keep-going`（后台跑，跑完汇报；`--show` 干跑审提示词，不写账本）
- **「12 张，主题 XX，16:9」主题批次**（先写提示词文件再一次跑完，不要逐张循环）：
  1. 写 `runs\<主题>-prompts.txt`，格式：`===== PROMPT 01 =====` 分块（每块一张完整提示词，遵守第五节格式）
  2. `node runner.mjs --prompts-file runs\<主题>-prompts.txt --loadout <id> --ratio 16:9 --keep-going`
  3. 补缺编号：`--skip "1,3"`；中断续跑：`--resume`
  4. 画幅：`--ratio 16:9`（`--mp 1.3` 调）或 `--size 1536x864`；运行时写进 #12，**不要复制工作流文件**
- 「复现那张」→ 查账本取 seed+prompt → `node runner.mjs --n 1 --seed <s> --loadout <l> --prompt "..."`
- 「换角色/改方向」→ 改 `lib\character.mjs`（**POOL_VERSION 必须递增**，否则去重串号）
- 「查账/缺什么图」→ `node tools/ledger_repair.mjs`（干跑即体检）

速度参考：模型在显存 ~2.5 分钟/张（含 2x RCAN 放大），一晚 150-250 张。

## 3. 守门机制（不用用户管）

- 单图 >500s：杀 ComfyUI → 原命令重启 → 原种子重试，最多 3 次
- 连续 3 张彻底失败：熔断停批（批次留在账本，`--resume` 可续）
- submit 被拒是确定性错误：不重试直接跳过
- 批次计划开跑前落盘；runner 挂了 `--resume` 续

## 4. 配方策展 SOP（Lora 管理器联动）

1. 用户在 ComfyUI 的 Lora 管理器导入新配方后说「策展一下」
2. `node tools/recipes_list.mjs --force` → 列 Krea2 且 LoRA 文件齐全的候选
3. 挑选：画风多样性优先、同栈去重；**读原配方 prompt 复核触发词**（字段不可靠，agent 必须人工确认）
4. `node tools/recipe2loadout.mjs --recipe <id前缀> --trigger "..." --lead "..." --weight N`
5. smoke：`node runner.mjs --n 1 --loadout recipe-<id> --prompt "<含触发词短提示>"`，出图才入池
6. 坑：LoRA 多根目录时校验用文件存在性而非 LoraLoader 枚举；模板 #17→#18 触发词链已切断防污染

## 5. Krea2 提示词格式

```
[LoRA触发词], [引导短语] [角色自然语言主句], [场景], [姿势], [表情].
[角色锚点标签行]   <- 每张一字不改（角色一致性）；体型特征写死在这
[服装标签行]
[表情+姿势标签行]
[构图+场景标签行]
[光线标签行]

[质量尾巴]
```

qwen3vl 编码器：自然语言给构图叙事，danbooru 标签锁细节，混合最优；turbo 流 cfg=1 不吃负向。详细规范 `<R>\skills\krea2-prompt.md`。

## 6. 当前 loadout 阵容（改动后更新此表）

见 `<R>\workflows\`——以 sidecar `.meta.json` 的 `weight` 字段为准（8 个起步：汉服梦织/sora72 画师古风/巨乳增强/3D/暗黑浪漫/半写实/怀旧动漫/童话插画）。

## 7. 排障速查

| 症状 | 处理 |
|---|---|
| no loadouts found | workflows\ 空了，重新转换或还原 |
| exit 5（another runner is active） | 有别的 runner 在跑。等它跑完 `--resume` 接手。**绝不能绕锁并行** |
| ledger is corrupt — refusing to reset | `node tools/ledger_repair.mjs --apply --download-missing` 从 history 重建 |
| ComfyUI 拉不起来 | config.json 的 comfy.exe/cwd 没配好（对照 config.example.json） |
| submit 被拒 | 工作流节点号变了（核对 #18/#201/#1535） |
| submit 被拒 value_not_in_list | 自定义节点枚举动态变（云同步抽预设）：preset 改 `custom` 保留 knob 数值 |
| 反复重启仍失败 | 查 ComfyUI 日志（LoRA 被挪/显存不足） |
| 主题批次补缺 | `--prompts-file ... --skip "已出图编号"` 或 `--resume` |
