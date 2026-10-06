import { describe, expect, test } from 'claude-code/testing'

import { addSpeed, addUsage, avgSpeed, fmt } from '../hooks/register'

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

  test('累加用量，子 agent 不改上下文', async () => {
    const empty = {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turnOutput: 0,
      contextTokens: null, contextWindow: 200000, usd: null,
    }
    const u = {
      model: 'm', input_tokens: 10, output_tokens: 20,
      cache_read_input_tokens: 1000, cache_creation_input_tokens: 5,
    }
    const main = addUsage(empty, u, true)
    expect(main.output).toBe(20)
    expect(main.turnOutput).toBe(20)
    expect(main.contextTokens).toBe(1015)
    const sub = addUsage(main, u, false)
    expect(sub.output).toBe(40)
    expect(sub.contextTokens).toBe(1015)
  })

  test('平均速度 = 总输出 / 总生成时间', async () => {
    const s0 = {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turnOutput: 0,
      contextTokens: null, contextWindow: null, usd: null,
    }
    expect(avgSpeed(s0)).toBeNull()
    const s1 = addSpeed(addSpeed(s0, 100, 2000), 300, 2000)
    expect(avgSpeed(s1)).toBe(100)
    expect(addSpeed(s1, 50, 0)).toEqual(s1)
  })

  test('用量条在各界面都能画，收起/展开可用', async ($, on) => {
    // 代表引擎自己的默认绘制
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'token-band', surface, ...BAND })
      expect((await ui.find({ type: 'Text' }))?.text).toContain('均速 —')
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
    expect((await ui.find({ type: 'Text' }))?.text).toContain('本轮输出')
    expect(await hint.find({ key: 'expand' })).toBeUndefined()
    await hint.unmount()
    await ui.unmount()
  })
})
