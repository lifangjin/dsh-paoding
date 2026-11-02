import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../tools/lib/util.mjs'
import { locatePersonaBlocks } from '../tools/lib/spans.mjs'
import { personaDefaultText } from '../tools/lib/compose.mjs'

// ── persona 契约测试（借自 dsh-superagent 的 prompt contract 思路）──────────────
//
// 五份 persona（主 agent 前缀 + 四个角色默认）是产品行为的成文合同，改动必须
// 有意识地进行：本文件用 RULES 表把「每份 persona 必须兑现的纪律」钉死——
// 汇报五态、提问纪律、诚实汇报、工具失败口径、主 agent 路由纪律。改 persona
// 可以，但删掉任何一条纪律会在这里红灯，强迫作者明确取舍（要么恢复措辞，
// 要么带着理由改 RULES——表就是文档）。
//
// 尺寸棘轮（SIZE_BUDGETS）：每份 persona 一个字符预算 = 2026-11 基线 + 5%
// 余量。只许变短或维持；要变大必须有意提高预算并说明理由——防止「随手往
// persona 里塞一句」的慢性膨胀（子 agent 上下文按份计费）。

const SRC = readFileSync(path.join(REPO_ROOT, 'presets/orchestrator/agent.cordis.yml'), 'utf8')
const SRC_LINES = SRC.split('\n')

/** 内置三角色的默认 persona（spans 定位 + compose 去缩进，与生成管线同源）。 */
function rolePersonas() {
  const blocks = locatePersonaBlocks(SRC, null)
  const out = {}
  for (const [role, block] of blocks) out[role] = personaDefaultText(block.text)
  return out
}

/** search_internal_deep 静态块 persona（10 空格块缩进手工剥）。 */
function deepPersona() {
  const startIdx = SRC_LINES.findIndex((l) => l.includes('- id: delegation-search-internal-deep'))
  assert.ok(startIdx >= 0, 'deep 静态委派块存在')
  let pIdx = -1
  for (let i = startIdx; i < SRC_LINES.length; i++) {
    if (/^ {8}persona: \|-$/.test(SRC_LINES[i])) { pIdx = i; break }
  }
  assert.ok(pIdx >= 0, 'deep 块 persona 存在')
  const out = []
  for (let i = pIdx + 1; i < SRC_LINES.length; i++) {
    if (/^ {10}\S/.test(SRC_LINES[i])) out.push(SRC_LINES[i].slice(10))
    else break
  }
  return out.join('\n')
}

/** 主 agent persona 前缀（顶层 persona 插件的 `prefix: |-` 块：键 4 空格、内容 6 空格）。 */
function mainPersona() {
  const mIdx = SRC_LINES.findIndex((l) => /^ {4}prefix: \|-$/.test(l))
  assert.ok(mIdx >= 0, '主 persona 前缀块存在')
  const out = []
  for (let i = mIdx + 1; i < SRC_LINES.length; i++) {
    const line = SRC_LINES[i]
    if (line.trim() === '') { out.push(''); continue }
    if (/^ {6}/.test(line)) out.push(line.slice(6)) // ≥6 空格：保留更深缩进（Routing 子列表 8 空格）
    else break // 缩进 < 6（回到 4 空格键）：块结束
  }
  return out.join('\n').replace(/\n+$/, '')
}

const ALL_ROLES = ['search_external', 'design', 'implement', 'search_internal_deep']
const EVERYONE = [...ALL_ROLES, 'main']

function personaOf(target) {
  if (target === 'main') return mainPersona()
  if (target === 'search_internal_deep') return deepPersona()
  return rolePersonas()[target]
}

/** 规则表：rule（人读 ID）→ target → required / forbidden 短语。 */
const RULES = [
  // —— 汇报纪律（五态）——
  {
    rule: 'status-line',
    targets: ALL_ROLES,
    required: ['Reporting: begin your final message with a status line — progress (partial, work continues)'],
  },
  {
    rule: 'state-blocked',
    targets: ALL_ROLES,
    required: ['blocked (a person must decide'],
  },
  {
    rule: 'state-failed-dropped',
    targets: ALL_ROLES,
    required: ['failed (cannot finish; say why)', 'dropped (nothing to'],
  },
  // —— ready 的角色化硬定义（不许虚报完成）——
  {
    rule: 'ready-definition',
    targets: {
      implement: ['ready (changes complete AND verified by an actually run build/test/grep)', 'Files written but not verified are progress, never ready'],
      design: ['ready (the spec is complete and grounded in the references you read)', 'a sketch alone is not ready'],
      search_external: ['ready (the research summary is complete and every claim carries its source)'],
      search_internal_deep: ['"Not found" is a valid finding — report it as searched-and-absent'],
    },
  },
  // —— 提问纪律（一次一问 + 引用原句 + 例行步骤选默认）——
  {
    rule: 'question-discipline',
    targets: ALL_ROLES,
    required: [
      'at most one concrete question at a time via ask_user_question',
      'quote the phrase that raised it',
      'choose reasonable defaults instead of asking about routine steps',
    ],
  },
  // —— 诚实汇报（不编造占位事实 / 未完成标未完成）——
  {
    rule: 'honest-reporting',
    targets: ALL_ROLES,
    required: ['Never invent placeholder facts', 'unfinished'],
  },
  // —— 工具失败口径（不重试被拒操作）——
  {
    rule: 'tool-failure',
    targets: ALL_ROLES,
    required: ['On tool failure, do not retry a denied operation'],
  },
  // —— 主 agent 路由纪律（不加戏 / 不代工 / 不轮询 / 诚实整合）——
  {
    rule: 'main-routing',
    targets: { main: ['Routing discipline:', 'never add requirements', 'Do not redo a delegated role', 'never wait with sleep', 'Integrate honestly'] },
  },
  // —— 全员禁语：占位 / 未定稿痕迹不许进 persona ——
  {
    rule: 'no-placeholders',
    targets: EVERYONE,
    forbidden: ['TODO', 'FIXME', 'TBD', 'lorem ipsum', 'XXX:'],
  },
]

/** 规则 targets 规范化 → [target, phrases|null][]（数组=全员同短语；映射=角色化短语）。 */
function targetEntries(targets) {
  if (Array.isArray(targets)) return targets.map((t) => [t, null])
  if (typeof targets === 'string') return [[targets, null]]
  return Object.entries(targets ?? {})
}

test('persona 契约：RULES 表逐条兑现（缺短语即红，改措辞须同步改表）', () => {
  for (const { rule, targets, required = [], forbidden = [] } of RULES) {
    for (const [target, phrases] of targetEntries(targets)) {
      const text = personaOf(target)
      const reqList = Array.isArray(phrases) ? phrases : required
      for (const phrase of reqList) {
        assert.ok(
          text.includes(phrase),
          `${target} persona 缺短语 [${phrase}]（规则 ${rule}）——措辞改了请同步 RULES，删纪律请带上理由`,
        )
      }
      for (const phrase of forbidden) {
        assert.ok(!text.includes(phrase), `${target} persona 出现禁语 [${phrase}]（规则 ${rule}）`)
      }
    }
  }
})

test('persona 契约：五个目标全部真实取到（空串 = 定位逻辑漂移）', () => {
  for (const target of EVERYONE) {
    const text = personaOf(target)
    assert.ok(text.length > 200, `${target} persona 过短（${text.length} 字符）——块定位可能漂移`)
    assert.match(text, /^You are /, `${target} persona 开头身份句仍在`)
  }
})

// ── 尺寸棘轮 ────────────────────────────────────────────────────────────────
// 基线（2026-11-02，Reporting/Questions 纪律 + 主 agent Routing discipline
// 升级后）：main 3326（prefix 全块，含委派失败 SOP）/ implement 1168 /
// design 1209 / search_external 1238 / deep 1604。预算 = 基线 + 5%（headroom
// 抹平微调噪音）。缩 persona 时请顺手降预算（棘轮只紧不松）；要扩必须有意
// 改这里并说明理由。
const SIZE_BUDGETS = {
  main: 3492,
  implement: 1226,
  design: 1269,
  search_external: 1300,
  search_internal_deep: 1684,
}

test('persona 尺寸棘轮：不超过预算（膨胀须有意提预算并给理由）', () => {
  for (const [target, budget] of Object.entries(SIZE_BUDGETS)) {
    const len = personaOf(target).length
    assert.ok(
      len <= budget,
      `${target} persona ${len} 字符 > 预算 ${budget}——确认新增内容值得每份子上下文都付这份成本，然后把 SIZE_BUDGETS.${target} 有意提高`,
    )
    // 顺带防断崖：不到基线一半说明纪律段可能被误删（契约表会同时红）。
    assert.ok(len > budget * 0.5, `${target} persona ${len} 字符 < 预算一半——疑似误删段落（对照 RULES 红项）`)
  }
})
