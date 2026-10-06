import { atom, read, update } from 'claude-code'
import type { Register, TurnUsage } from 'claude-code'

import type { ModelCheck, TokenStats } from '../types'

const EMPTY: TokenStats = {
  totalInput: 0,
  totalCacheRead: 0,
  cacheInput: 0,
  output: 0,
  turnOutput: 0,
  speedTokens: 0,
  speedMs: 0,
  contextTokens: null,
  contextWindow: null,
  rateLimits: [],
  usd: null,
}

const stats = atom({ plugin: 'token-band', key: 'stats' } as const, EMPTY)
const isHidden = atom({ plugin: 'token-band', key: 'isHidden' } as const, false)
const check = atom({ plugin: 'token-band', key: 'check' } as const, {
  issues: [],
  effortWanted: null,
} as ModelCheck)

/** 不换行空格 */
const NBSP = '\u00a0'

/** 12345 -> "12.3k"，1234567 -> "1.23M" */
export function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/**
 * 累加一次回复的用量。isMain：主对话的请求，它的输入量就是当前上下文占用；
 * isTurnStart：主对话一轮的第一次请求，本轮计数从它清零
 */
export function addUsage(
  s: TokenStats,
  u: TurnUsage,
  isMain: boolean,
  isTurnStart: boolean,
): TokenStats {
  const input = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  return {
    ...s,
    totalInput: (s.totalInput ?? 0) + input,
    totalCacheRead: (s.totalCacheRead ?? 0) + u.cache_read_input_tokens,
    cacheInput: (s.cacheInput ?? 0) + input,
    output: s.output + u.output_tokens,
    turnOutput: (isTurnStart ? 0 : s.turnOutput) + u.output_tokens,
    contextTokens: isMain ? input : s.contextTokens,
  }
}

/** 累加一次回复的测速样本；耗时为 0 的不计 */
export function addSpeed(s: TokenStats, outputTokens: number, ms: number): TokenStats {
  if (ms <= 0 || outputTokens <= 0) return s
  return {
    ...s,
    speedTokens: (s.speedTokens ?? 0) + outputTokens,
    speedMs: (s.speedMs ?? 0) + ms,
  }
}

/** 缓存命中率（0~100），还没有输入时为 null */
export function cacheHitRate(s: TokenStats): number | null {
  const total = s.cacheInput ?? 0
  return total > 0 ? ((s.totalCacheRead ?? 0) / total) * 100 : null
}

const LIMIT_LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

/** [{ five_hour, 23 }, { seven_day, 41.5 }] -> ['5h 23%', '7d 42%']；别的窗口原样用名字 */
export function formatLimits(limits: readonly { kind: string; percentUsed: number }[]): string[] {
  return limits.map(l => `${LIMIT_LABEL[l.kind] ?? l.kind} ${Math.round(l.percentUsed)}%`)
}

/** 平均输出速度（token/秒），没有样本时为 null */
export function avgSpeed(s: TokenStats): number | null {
  const ms = s.speedMs ?? 0
  return ms > 0 ? ((s.speedTokens ?? 0) / ms) * 1000 : null
}

/** 'claude-sonnet-4-5-20250929[1m]' -> 'sonnet-4-5' */
export function shortModel(model: string): string {
  return model
    .toLowerCase()
    .replace(/\[.*\]$/, '')
    .replace(/-\d{8}$/, '')
    .replace(/^claude-/, '')
}

/**
 * 两个模型名是否指同一个模型。别名（opus、sonnet、default 这类不带版本号的）
 * 只要求对方属于同一系列，无法判断的一律当作一致，宁可漏报也不误报
 */
export function sameModel(a: string, b: string): boolean {
  const x = shortModel(a)
  const y = shortModel(b)
  if (x === y) return true
  const isAlias = (m: string) => !/\d/.test(m)
  if (isAlias(x) || isAlias(y)) {
    const [alias, full] = isAlias(x) ? [x, y] : [y, x]
    return alias === 'default' || full.includes(alias)
  }
  return false
}

const EFFORT_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, xhigh: 4, max: 5 }

/** 实际强度比请求的低时返回「强度 high→medium」，否则 null */
export function effortIssue(wanted: string | null, actual: string | undefined): string | null {
  if (!wanted || !actual) return null
  const w = EFFORT_RANK[wanted]
  const a = EFFORT_RANK[actual]
  if (w === undefined || a === undefined || a >= w) return null
  return `强度 ${wanted}→${actual}`
}

/** 把新发现的异常并进本轮 */
function addIssue(c: ModelCheck, issue: string): ModelCheck {
  return c.issues.includes(issue) ? c : { ...c, issues: [...c.issues, issue] }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tokens',
      description: '展开/收起输入框上方的 token 用量条',
    })
    const usage = await $.session.usage()
    await update($, stats, s => ({
      ...s,
      contextTokens: usage.context.tokens ?? s.contextTokens ?? null,
      contextWindow: usage.context.window,
      rateLimits: usage.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed })),
      usd: usage.cost?.usd ?? s.usd,
    }))
    return next(e)
  })

  on('command.run', { command: 'tokens' }, async $ => {
    const hidden = await update($, isHidden, h => !h)
    return { text: hidden ? 'token 用量条已收起' : 'token 用量条已展开' }
  })

  // 每次模型请求返回后立刻累加，所以一轮里会实时跳动。
  // 测速从第一个内容片段到最后一片，不含等待首字的时间
  on('turn.step', async function* ($, e, next) {
    // 主对话一轮的第一次请求：新的一轮开始。不用 turn.start，免得子 agent 的轮次把本轮清零
    const isTurnStart = e.agentId === undefined && e.index === 0
    if (isTurnStart) {
      await update($, check, c => ({ ...c, issues: [] }))
    }

    const stream = next(e)
    let firstAt: number | null = null
    for await (const chunk of stream) {
      if (firstAt === null && chunk.kind !== 'engine') {
        firstAt = await $.clock.now()
      }
      yield chunk
    }
    const endAt = await $.clock.now()
    const result = await stream.result
    const usage = result.usage
    if (usage) {
      const ms = firstAt === null ? 0 : endAt - firstAt
      await update($, stats, s =>
        addSpeed(
          addUsage(s, usage, e.agentId === undefined, isTurnStart),
          usage.output_tokens,
          ms,
        ),
      )
    }

    // 模型一致性只看主对话：子 agent 本来就可能用别的模型
    if (e.agentId === undefined) {
      const selected = await $.session.model()
      const found: string[] = []
      if (!sameModel(selected, e.model)) found.push(`已切到 ${shortModel(e.model)}`)
      if (usage && !sameModel(e.model, usage.model)) {
        found.push(`实际回答 ${shortModel(usage.model)}`)
      }
      const wanted = typeof e.effort === 'string' ? e.effort : null
      const before = await read($, check)
      const after = await update($, check, c =>
        found.reduce(addIssue, { ...c, effortWanted: wanted }),
      )
      if (after.issues.length > before.issues.length) {
        $.ui.toast(`❌ 模型异常：${after.issues.join(' · ')}`)
      }
    }
    return result
  })

  // 一轮结束时拿到「静默降级之后」的实际思考强度，和请求时比较
  on('classic.Stop', async ($, e, next) => {
    const c = await read($, check)
    const issue = effortIssue(c.effortWanted, e.effort?.level)
    if (issue) {
      await update($, check, x => addIssue(x, issue))
      $.ui.toast(`❌ 思考强度被调低：${issue.replace('强度 ', '')}`)
    }
    return next(e)
  })

  // 引擎测量后推送：校准上下文、额度和费用
  on('session.measure', async ($, e, next) => {
    await update($, stats, s => ({
      ...s,
      contextTokens: e.context.tokens ?? s.contextTokens ?? null,
      contextWindow: e.context.window,
      rateLimits: e.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed })),
      usd: e.cost?.usd ?? s.usd,
    }))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    // 收起时整栏不画（连桌面端的灰底一起消失），展开按钮在输入框下方工具栏右侧
    if (await read($, isHidden)) {
      return next(e)
    }

    const s = await read($, stats)
    const { Box, Button, Text } = $.ui.resolve(e)

    const avg = avgSpeed(s)
    const ctx = !s.contextWindow
      ? '—'
      : s.contextTokens == null
        ? `—/${fmt(s.contextWindow)}`
        : `${fmt(s.contextTokens)}/${fmt(s.contextWindow)} (${Math.round(
            (s.contextTokens / s.contextWindow) * 100,
          )}%)`
    const parts = [
      ctx,
      `本轮 ${fmt(s.turnOutput)}`,
      `${avg === null ? '—' : Math.round(avg)} tok/s`,
      `总输入 ${fmt(s.totalInput ?? 0)}`,
      `总输出 ${fmt(s.output)}`,
    ]
    const hit = cacheHitRate(s)
    if (hit !== null) parts.push(`缓存 ${Math.round(hit)}%`)
    if (s.usd !== null) parts.push(`$${s.usd.toFixed(2)}`)
    // 不是订阅账号时没有额度数据，这一段就不显示
    parts.push(...formatLimits(s.rateLimits ?? []))
    // 模型检测只用一个符号：正常 ✅，本轮有异常 ❌（细节在弹出的提示里）
    const health = (await read($, check)).issues.length > 0 ? '❌' : '✅'

    // 文字区可以收缩、自动折行；按钮不收缩，固定在第一行最右边
    return (
      <Box flexDirection="row" alignItems="flex-start" columnGap={1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text dimColor>
            {/* 每一项内部换成不换行空格，「·」也粘在前一项后面：只在「· 」之后折行，不会把一项劈成两半 */}
            {parts.map(p => p.replace(/ /g, NBSP)).join(`${NBSP}· `)} {health}
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Button
            key="toggle"
            label="收起"
            dimColor
            onPress={() => update($, isHidden, () => true)}
          />
        </Box>
      </Box>
    )
  })

  // 收起时：在输入框下方工具栏右侧的模式标签处加一个小按钮，原有内容保持不动
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const engine = await next(e)
    if (!(await read($, isHidden))) {
      return engine
    }

    const { Box, Button } = $.ui.resolve(e)
    const hasIssue = (await read($, check)).issues.length > 0

    return (
      <Box>
        {engine}
        <Button
          key="expand"
          label={hasIssue ? '❌' : '🪙'}
          plain
          dimColor
          onPress={() => update($, isHidden, () => false)}
        />
      </Box>
    )
  })
}
