// Character prompt pools v2 — 古风仙子 NSFW 向。
// 旗袍兔女郎只是服装池里的两席，主体是汉服/仙气 + NSFW 泄露感。
// 每个条目: t = danbooru 风格标签, p = 给 qwen3vl 文本编码器的自然语言短语。

export const POOL_VERSION = 'v2-gufeng'

export const CHARACTER = {
  id: 'foxangel',
  // 固定锚点：角色身份 + 体型（巨乳写死，不进随机池）
  anchors: '1girl, solo, golden eyes, white long hair, fox ears, silver eyelashes, angel halo, wings on waist, huge breasts, curvy, narrow waist, pale skin',
  intro: 'a white-haired fox-eared celestial fairy with golden eyes, a floating halo and small wings at her waist',
}

export const OUTFITS = [
  { t: 'sheer white hanfu, transparent sleeves, sideboob, underboob, see-through fabric, no bra', p: 'in a sheer white hanfu with translucent sleeves' },
  { t: 'qipao, bunny girl outfit, playboy bunny, black fishnet thighhighs, rabbit ears headband, cleavage cutout, wrist cuffs', p: 'in a qipao-style bunny girl outfit' },
  { t: 'white qipao, gold embroidery, side slit, no bra, sideboob, garter strap', p: 'in a gold-embroidered white qipao with a high side slit' },
  { t: 'daxiushan, wide sleeves, floating ribbons, chest opening, cleavage, detached sleeves', p: 'in flowing daxiushan robes with wide sleeves' },
  { t: 'ruqun, chest-length skirt, chest opening, sideboob, sheer fabric', p: 'in a chest-length ruqun with an open collar' },
  { t: 'feather robe, feather trim, shoulder openings, sideboob, gold anklet', p: 'in a divine feather robe baring her shoulders' },
  { t: 'lotus-themed wrap top, underboob, navel, low-waist sarong, flower hairpin', p: 'in a lotus-themed wrap top and sarong' },
  { t: 'open front robe, single sleeve slipped off, holding robe closed, exposed shoulder, cleavage', p: 'holding her slipping robe closed' },
  { t: 'tied-front top, underboob, navel, low-waist skirt, hip focus', p: 'in a tied-front top that barely holds' },
  { t: 'xiuhefu, red bridal outfit, phoenix crown, see-through red veil, cleavage', p: 'in a sheer red bridal xiuhefu with a phoenix crown' },
  { t: 'gold garter chains, minimal lingerie, sheer white stockings, anklet', p: 'in minimal white lingerie with gold chains' },
  { t: 'dance costume, flowing silk sleeves, bare midriff, side slit skirt, thigh ribbon', p: 'in a silk dance costume with a bare midriff' },
  { t: 'sheer nightgown, lace trim, nipple slip, off shoulder', p: 'in a sheer lace nightgown' },
]

export const SCENES = [
  { t: 'moonlit lotus pond, koi fish, water ripples, mist', p: 'above a moonlit lotus pond' },
  { t: 'peach blossom grove, petal storm, falling petals', p: 'in a storm of peach blossom petals' },
  { t: 'bamboo forest, fireflies, night', p: 'in a firefly-lit bamboo forest' },
  { t: 'sea of clouds, floating petals, distant celestial palace', p: 'on a sea of clouds before a celestial palace' },
  { t: 'ancient pavilion by a waterfall, rainbow mist', p: 'in an ancient pavilion beside a waterfall' },
  { t: 'red lantern corridor at night, warm glow', p: 'under a corridor of glowing red lanterns' },
  { t: 'snowy plum garden, falling snow, red plum blossoms', p: 'among red plum blossoms in falling snow' },
  { t: 'abandoned celestial shrine, hanging talismans, vines, faint glow', p: 'in an abandoned shrine strung with glowing talismans' },
  { t: 'galaxy shallow water, star sand, milky way above', p: 'wading in a shallow pool of starlight' },
  { t: 'misty hotspring, rocks, red maple leaves floating', p: 'at a misty hotspring scattered with maple leaves' },
  { t: 'ink-wash void, floating ink clouds, brush stroke background', p: 'floating in an ink-wash dreamscape' },
  { t: 'silk drapery bedroom, gauze canopy, scattered cushions', p: 'on silk cushions beneath a gauze canopy' },
]

export const POSES = [
  { t: 'dancing, swirling sleeves, ribbons in motion', p: 'mid-dance with swirling sleeves' },
  { t: 'looking back over shoulder, hand tucking hair behind ear', p: 'glancing back over her shoulder' },
  { t: 'kneeling on water surface, ripples, sleeves trailing', p: 'kneeling on the water surface itself' },
  { t: 'adjusting slipping sleeve, one shoulder bare', p: 'catching her slipping sleeve' },
  { t: 'stretching, arms overhead, back arch', p: 'stretching with a back arch' },
  { t: 'holding oil-paper umbrella, walking in rain', p: 'beneath an oil-paper umbrella' },
  { t: 'lying on cushions, propping head with hand, sideways', p: 'lying sideways propping her head' },
  { t: 'covering mouth with sleeve, mischievous eyes', p: 'hiding a smile behind her sleeve' },
  { t: 'playing guqin, sleeves falling, seated', p: 'playing a guqin' },
  { t: 'lifting skirt hem, stepping into shallow water', p: 'stepping into shallow water' },
  { t: 'arms behind back, leaning toward viewer', p: 'leaning toward the viewer' },
  { t: 'floating cross-legged, hair drifting weightless', p: 'floating weightlessly in the air' },
]

export const EXPRESSIONS = [
  { t: 'gentle smile', p: 'smiling gently' },
  { t: 'half-lidded eyes, seductive gaze, parted lips', p: 'with a seductive half-lidded gaze' },
  { t: 'shy blush, looking away', p: 'blushing shyly' },
  { t: 'playful wink, tongue out', p: 'winking playfully' },
  { t: 'serene expression, closed eyes', p: 'serene with closed eyes' },
  { t: 'surprised, fingers to lips', p: 'touching her lips in surprise' },
  { t: 'smug smile, chin up', p: 'wearing a smug little smile' },
  { t: 'misty eyes, biting lip', p: 'biting her lip with misty eyes' },
]

export const LIGHTING = [
  { t: 'cool moonlight, silver rim light', p: 'bathed in cool moonlight' },
  { t: 'warm lantern glow, gentle shadows', p: 'lit by warm lantern glow' },
  { t: 'divine golden backlight, halo glow', p: 'backlit with divine golden light' },
  { t: 'dawn mist, diffused pale light', p: 'in pale dawn mist' },
  { t: 'dappled light through petals', p: 'in dappled petal-filtered light' },
  { t: 'candlelight, flickering deep shadows', p: 'by flickering candlelight' },
]

export const CAMERAS = [
  { t: 'cowboy shot', p: 'framed cowboy-shot' },
  { t: 'full body', p: 'framed full-body' },
  { t: 'upper body portrait', p: 'framed as an upper-body portrait' },
  { t: 'from above', p: 'shot from above' },
  { t: 'from below, low angle', p: 'shot from a low angle' },
  { t: 'profile view', p: 'in profile' },
  { t: 'back view, looking back', p: 'from behind as she looks back' },
]

// 默认质量尾巴（loadout 没解析到时用）
export const DEFAULT_QUALITY_TAIL =
  'masterpiece, very aesthetic, best quality, amazing quality, highres, absurdres, refined details, beautiful detailed eyes, dreamy atmosphere, rich colors, painterly.'

// ---- 组合器 ----
const POOLS = { OUTFITS, SCENES, POSES, EXPRESSIONS, LIGHTING, CAMERAS }
const POOL_KEYS = Object.keys(POOLS)

export function comboSpaceSize() {
  return POOL_KEYS.reduce((n, k) => n * POOLS[k].length, 1)
}

export function randomCombo(random = Math.random) {
  const combo = {}
  for (const k of POOL_KEYS) {
    const arr = POOLS[k]
    combo[k] = arr[Math.floor(random() * arr.length)]
  }
  return combo
}

// 带池版本与 loadout 前缀：换池/换画风后旧账本不会误伤新组合
export function comboKey(combo, loadoutId = '') {
  return `${POOL_VERSION}|${loadoutId}|` + POOL_KEYS.map((k) => POOLS[k].indexOf(combo[k])).join('-')
}

// 组装成工作流 #18 节点的 text。
// style = { trigger: 触发词串, lead: 引导短语(可空), qualityTail: 质量尾巴 }
export function buildPrompt(combo, style = {}) {
  const c = combo
  const trigger = style.trigger || ''
  const head = [trigger, style.lead].filter(Boolean).join(', ')
  const tail = style.qualityTail || DEFAULT_QUALITY_TAIL
  return [
    `${head} ${CHARACTER.intro} ${c.OUTFITS.p}, ${c.SCENES.p}, ${c.POSES.p}, ${c.EXPRESSIONS.p}.`,
    `${CHARACTER.anchors},`,
    `${c.OUTFITS.t},`,
    `${c.EXPRESSIONS.t}, ${c.POSES.t},`,
    `${c.CAMERAS.t}, ${c.SCENES.t},`,
    `${c.LIGHTING.t},`,
    '',
    `${tail}`,
  ].join('\n')
}
