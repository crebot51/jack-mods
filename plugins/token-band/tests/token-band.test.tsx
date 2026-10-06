import { describe, expect, test } from 'claude-code/testing'

import { addSpeed, addUsage, avgSpeed, cacheHitRate, formatLimits, effortIssue, fmt, sameModel, shortModel } from '../hooks/register'

const HINT = {
  component: 'SessionMode',
  props: { modes: [] },
} as const

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

describe('token-band', () => {
  test('数字格式化', async () => {
    expect(fmt(999)).toBe('999')
    expect(fmt(12345)).toBe('12.3k')
    expect(fmt(1234567)).toBe('1.23M')
  })

  test('累加用量：总输入含缓存，子 agent 不改上下文，新一轮从零开始', async () => {
    const empty = { output: 0, turnOutput: 0, usd: null }
    const u = {
      model: 'm', input_tokens: 10, output_tokens: 20,
      cache_read_input_tokens: 1000, cache_creation_input_tokens: 5,
    }
    const t1 = addUsage(empty, u, true, true)
    expect(t1.totalInput).toBe(1015)
    expect(t1.contextTokens).toBe(1015)
    const t1b = addUsage(t1, { ...u, cache_read_input_tokens: 0 }, false, false)
    expect(t1b.totalInput).toBe(1030)
    expect(t1b.contextTokens).toBe(1015)
    expect(t1b.turnOutput).toBe(40)
    const t2 = addUsage(t1b, u, true, true)
    expect(t2.output).toBe(60)
    expect(t2.turnOutput).toBe(20)
  })

  test('缓存命中率与额度格式', async () => {
    const empty = { output: 0, turnOutput: 0, usd: null }
    expect(cacheHitRate(empty)).toBeNull()
    const u = {
      model: 'm', input_tokens: 10, output_tokens: 0,
      cache_read_input_tokens: 980, cache_creation_input_tokens: 10,
    }
    expect(cacheHitRate(addUsage(empty, u, true, true))).toBe(98)
    expect(formatLimits([
      { kind: 'five_hour', percentUsed: 23 },
      { kind: 'seven_day', percentUsed: 41.5 },
      { kind: 'spend_limit', percentUsed: 7 },
    ])).toEqual(['5h 23%', '7d 42%', 'spend_limit 7%'])
  })

  test('平均速度 = 总输出 / 总生成时间', async () => {
    const s0 = { output: 0, turnOutput: 0, usd: null }
    expect(avgSpeed(s0)).toBeNull()
    const s1 = addSpeed(addSpeed(s0, 100, 2000), 300, 2000)
    expect(avgSpeed(s1)).toBe(100)
    expect(addSpeed(s1, 50, 0)).toEqual(s1)
  })

  test('模型名比较：版本、日期、[1m] 后缀、别名', async () => {
    expect(shortModel('claude-sonnet-4-5-20250929[1m]')).toBe('sonnet-4-5')
    expect(sameModel('claude-opus-5-5[1m]', 'claude-opus-5-5')).toBe(true)
    expect(sameModel('opus', 'claude-opus-5-5')).toBe(true)
    expect(sameModel('default', 'claude-sonnet-4-5')).toBe(true)
    expect(sameModel('claude-opus-5-5', 'claude-sonnet-4-5-20250929')).toBe(false)
    expect(sameModel('opus', 'claude-sonnet-4-5')).toBe(false)
  })

  test('思考强度只在被调低时报告', async () => {
    expect(effortIssue('high', 'medium')).toBe('强度 high→medium')
    expect(effortIssue('high', 'high')).toBeNull()
    expect(effortIssue('medium', 'max')).toBeNull()
    expect(effortIssue(null, 'low')).toBeNull()
    expect(effortIssue('high', undefined)).toBeNull()
  })

  test('用量条在各界面都能画，收起/展开可用', async ($, on) => {
    // 代表引擎自己的默认绘制
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'token-band', surface, ...BAND })
      // 每一项内部是不换行空格，比较前换回普通空格
      const shown = (await ui.find({ type: 'Text' }))?.text.replace(/\u00a0/g, ' ')
      expect(shown).toContain('— tok/s')
      expect((await ui.find({ type: 'Text' }))?.text).toContain('✅')
      await ui.unmount()
    }
    // 收起状态是整个会话共享的，所以只在一个界面上来回切
    const ui = await $.ui.mount({ plugin: 'token-band', surface: 'terminal', ...BAND })
    const hint = await $.ui.mount({ plugin: 'token-band', surface: 'terminal', ...HINT })
    expect(await hint.find({ key: 'expand' })).toBeUndefined()

    await ui.press({ key: 'toggle' })
    // 上方整栏交还给引擎：引擎在这里画的是 engine 文本
    expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
    expect(await ui.find({ key: 'toggle' })).toBeUndefined()
    // 下方提示行出现展开按钮，原内容还在
    expect(await hint.find({ key: 'expand' })).toBeDefined()
    expect((await hint.find({ type: 'Text' }))?.text).toBe('engine')

    await hint.press({ key: 'expand' })
    expect((await ui.find({ type: 'Text' }))?.text).toContain('本轮')
    expect(await hint.find({ key: 'expand' })).toBeUndefined()
    await hint.unmount()
    await ui.unmount()
  })
})
