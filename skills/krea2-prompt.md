# krea2-prompt：Krea2/FLUX.2 系提示词工程技能

> 适用：DSH agent 为 `dsh-comfy-runner` 写提示词、扩维度池、策展 Lora 配方时。
> 依据：`E:\woyao\custom_nodes\llm_prompt_node\prompt_rules\krea2.yaml`（8 条规则）、
> 用户工作流 `Krea2_修脸修手串联` 的实际提示词格式、Lora Manager 配方库 154 份样本。

## 一、核心规则（来自 krea2.yaml，必须遵守）

1. **忠实第一**：保留原始主体、动作、颜色、空间关系；不添加用户没暗示的道具/角色/动物
2. **T2I 可解析结构**：主体与其属性、动作分组写；姿势/交互/布局用落地措辞（不写抽象形容词）
3. **风格规划内化**：风格/媒介/构图/光线的取舍在内部思考完成，正文不输出规划标签
4. **文字渲染**：要求画面内出现文字时，精确指定内容并用引号包裹
5. **避免过度指定**：输入没支持的服装/颜色/材质细节不凭空发明
6. **成段结构**：思考后输出一段连贯文字；无列表、无 JSON、无 markdown
7. **尊重既有细节**：提示词已详细时轻抛光，不推翻重写
8. **尊重指定媒介**：用户明说 photo/painting/3D render 就照办，不因难度改道

## 二、格式基准（用户工作流实证有效的结构）

Krea2 用 qwen3vl 文本编码器（type=krea2），**自然语言与 danbooru 标签混合**效果最好：

```
[LoRA触发词], [引导短语] [角色自然语言主句], [场景], [姿势], [表情].
[角色锚点标签行]            <- 身份特征，保持稳定
[服装标签行]
[表情+姿势标签行]
[构图+场景标签行]
[光线标签行]

[质量尾巴]
```

要点：
- **锚点行每张图一字不改**（角色一致性靠它）：`1girl, solo, golden eyes, white long hair, fox ears, silver eyelashes, angel halo, wings on waist, huge breasts, ...`
- 体型类特征（巨乳等）写进锚点行，不进随机池
- 自然语言主句给 qwen3vl 读构图和叙事；标签行给扩散模型锁定细节
- turbo 流 cfg=1 不吃负向，负向留空即可

## 三、NSFW 词汇参考（danbooru 规范 tag）

泄露感：`areola slip, nipple slip, underboob, sideboob, cleavage, see-through, transparent clothes, clothes pull, strap slip`
服装：`micro bikini, sling bikini, garter straps, fishnet thighhighs, playboy bunny, lace trim, no bra`
身体：`huge breasts, curvy, narrow waist, wide hips, thick thighs, navel`
情境：`embarrassed, blush, covering breasts, arm support, lying, on back`
（写池子时按角色气质挑选，不要全堆——过度指定违反规则 5）

## 四、配方样本精华（civitai 高手的结构，供参考）

Monty 猫娘配方展示了高级写法——按**段落分工**：
1. 主体段：人物+动作+镜头（自然语言）
2. 背景段：环境元素+负空间布局
3. 光效段：光源方向+阴影质感（`no strong rim light` 这种否定式指定也有效）
4. 色板段：限定色彩列表（`restrained black-white-grey monochrome with tiny green-blue accents`）
5. 文字段：`thin hollow letters spelling "COOL CAT"`，引号包裹

适用场景：主打图（agent 精写的完整提示词）可以用这种全结构；
随机组合图用第二节的标准结构即可。

## 五、维度池规范（lib/character.mjs）

- 每条目双编码：`t`（danbooru 标签）+ `p`（自然语言短语，嵌主句）
- 池子：服装 / 场景 / 姿势 / 表情 / 光线 / 构图，各 6-14 条
- 去重：组合键 = 池版本|loadout|各维度索引；相邻两张至少差 5 个维度（冷却）
- **换角色**：改 `CHARACTER.anchors/intro` + 重写池子，`POOL_VERSION` 递增
- **服装建议只占池中少数席位**（用户明确要求：多样性是核心，不搞全套同质化）

## 六、策展 SOP（模式 A：出门前策展）

1. `node tools/recipes_list.mjs` —— 拉 Krea2 + 可转换配方清单
2. 按方向筛选（本会话基准：古风仙子 NSFW 向，NSFW 为主掺少量 SFW 画风增多样性）：
   - NSFW 等级（civitai 位标志：2=Mature, 4=Explicit, 8=X, 16=XXX 组合）
   - 画风多样性优先于数量；同栈配方去重
   - 看原配方的 prompt 判断触发词与画风
3. `node tools/recipe2loadout.mjs --recipe <id> --trigger "..." [--weight N]` 转换
   - **触发词必复核**：从配方原 prompt 提取草稿，agent 按风格 lora 名和 civitai 惯例确认
   - 质量尾巴默认用通用款，配方有特色时覆盖
4. smoke test：`node runner.mjs --n 1 --loadout recipe-xxxxxxxx --prompt "<含触发词的短提示>"`
   - 出图 = 通过；提交被拒/超时重启后仍挂 = 踢掉
5. 排夜间队列：`node runner.mjs --n 50 --keep-going`（loadout 加权混抽 + 看门狗 + 断点续跑）

## 七、工具速查

| 命令 | 作用 |
|---|---|
| `node tools/recipes_list.mjs --force` | 重拉配方并打印候选表 |
| `node tools/recipe2loadout.mjs --recipe <id> --trigger "..."` | 配方转 loadout |
| `node runner.mjs --n 3 --show` | 干跑看提示词 |
| `node runner.mjs --n 50 --keep-going` | 夜间批量（看门狗+熔断+续跑） |
| `node runner.mjs --resume` | 从中断批次继续 |
| `node runner.mjs --n 1 --loadout <id> --prompt "..."` | 单张验证 / 复现 |

账本 `runs/runs.json`：每张图的种子、loadout、组合键、完整提示词、产物路径。
复现单张：从账本查种子和提示词，用 `--loadout` + `--prompt` 重跑。

## 八、约束与坑

- LoRA 双根目录：`E:\woyao\models\loras` 和 `F:\新建文件夹 (6)\models\loras`（名字解析按 `models/loras/` 后的相对路径）
- 配方 cfg=4/steps=30 的是 Anima 系，跳过（本流是 Krea2 turbo cfg=1）
- 换工作流模板后核对参数化节点号（当前 #18 提示词 / #201 种子 / #1535 保存）
- `#2` 节点的 loras 数组和 text 必须同步 patch，不同步会导致 UI 显示与实际加载不一致
