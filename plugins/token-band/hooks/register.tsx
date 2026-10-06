import { atom, read, update } from 'claude-code'
import type { Register, TurnUsage } from 'claude-code'

import type { TokenStats } from '../types'

const EMPTY: TokenStats = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  turnOutput: 0,
  contextTokens: null,
  contextWindow: null,
  speedTokens: 0,
  speedMs: 0,
  usd: null,
}

const stats = atom({ plugin: 'token-band', key: 'stats' } as const, EMPTY)
const isHidden = atom({ plugin: 'token-band', key: 'isHidden' } as const, false)

/** 12345 -> "12.3k"，1234567 -> "1.23M" */
export function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function addUsage(s: TokenStats, u: TurnUsage, isMain: boolean): TokenStats {
  return {
    ...s,
    input: s.input + u.input_tokens,
    output: s.output + u.output_tokens,
    cacheRead: s.cacheRead + u.cache_read_input_tokens,
    cacheWrite: s.cacheWrite + u.cache_creation_input_tokens,
    turnOutput: s.turnOutput + u.output_tokens,
    // 只有主对话的请求才代表当前上下文大小
    contextTokens: isMain
      ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      : s.contextTokens,
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

/** 平均输出速度（token/秒），没有样本时为 null */
export function avgSpeed(s: TokenStats): number | null {
  const ms = s.speedMs ?? 0
  return ms > 0 ? ((s.speedTokens ?? 0) / ms) * 1000 : null
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
      contextTokens: usage.context.tokens ?? s.contextTokens,
      contextWindow: usage.context.window,
      usd: usage.cost?.usd ?? s.usd,
    }))
    return next(e)
  })

  on('command.run', { command: 'tokens' }, async $ => {
    const hidden = await update($, isHidden, h => !h)
    return { text: hidden ? 'token 用量条已收起' : 'token 用量条已展开' }
  })

  // 新的一轮开始：清零"本轮"计数
  on('turn.start', async ($, e, next) => {
    await update($, stats, s => ({ ...s, turnOutput: 0 }))
    return next(e)
  })

  // 每次模型请求返回后立刻累加，所以一轮里会实时跳动。
  // 测速从第一个内容片段到最后一片，不含等待首字的时间
  on('turn.step', async function* ($, e, next) {
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
        addSpeed(addUsage(s, usage, e.agentId === undefined), usage.output_tokens, ms),
      )
    }
    return result
  })

  // 引擎测量后推送：校准上下文和费用
  on('session.measure', async ($, e, next) => {
    await update($, stats, s => ({
      ...s,
      contextTokens: e.context.tokens ?? s.contextTokens,
      contextWindow: e.context.window,
      usd: e.cost?.usd ?? s.usd,
    }))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const s = await read($, stats)
    const isCollapsed = await read($, isHidden)
    const { Box, Button, Text } = $.ui.resolve(e)

    const percent =
      s.contextTokens !== null && s.contextWindow
        ? Math.round((s.contextTokens / s.contextWindow) * 100)
        : null
    // 收起时整栏不画（连桌面端的灰底一起消失），展开按钮在输入框下方工具栏右侧
    if (isCollapsed) {
      return next(e)
    }

    const ctx =
      percent !== null
        ? `上下文 ${fmt(s.contextTokens ?? 0)}/${fmt(s.contextWindow ?? 0)} (${percent}%)`
        : '上下文 —'
    const total = `累计 输入 ${fmt(s.input)} · 输出 ${fmt(s.output)} · 缓存读 ${fmt(s.cacheRead)}`
    const turn = `本轮输出 ${fmt(s.turnOutput)}`
    const avg = avgSpeed(s)
    const speed = `均速 ${avg === null ? '—' : `${avg.toFixed(1)} tok/s`}`
    const cost = s.usd !== null ? ` · $${s.usd.toFixed(3)}` : ''

    return (
      <Box>
        <Text dimColor>
          🪙 {ctx} │ {turn} │ {speed} │ {total}
          {cost}{' '}
        </Text>
        <Button
          key="toggle"
          label="收起"
          dimColor
          onPress={() => update($, isHidden, () => true)}
        />
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

    return (
      <Box>
        {engine}
        <Button
          key="expand"
          label="🪙"
          plain
          dimColor
          onPress={() => update($, isHidden, () => false)}
        />
      </Box>
    )
  })
}
