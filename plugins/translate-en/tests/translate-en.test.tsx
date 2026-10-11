import { describe, expect, mock, test } from 'claude-code/testing'

import { PANE, errorReason, maskKey, needsTranslation, normalizeBase, parseCompletion, parseModels } from '../hooks/register'

const COMPOSE = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as const
const BUTTON = { component: 'SessionMode', props: { modes: [] } } as const
const PANEL = { component: 'Pane', requestId: PANE,
  props: { title: '翻译成英文', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

describe('translate-en', () => {
  test('哪些消息要翻译', async () => {
    expect(needsTranslation('你好')).toBe(true)
    expect(needsTranslation('fix 这个 bug')).toBe(true)
    expect(needsTranslation('hello world')).toBe(false)
    expect(needsTranslation('/compact 你好')).toBe(false)
    expect(needsTranslation('   ')).toBe(false)
    expect(needsTranslation('price → 100€')).toBe(false)
  })

  test('地址、Key、回复解析', async () => {
    expect(normalizeBase(' https://a.com/v1/ ')).toBe('https://a.com/v1')
    expect(normalizeBase('https://a.com/v1/chat/completions')).toBe('https://a.com/v1')
    expect(maskKey('sk-1234567890abcd')).toBe('sk-…abcd')
    expect(parseModels('{"data":[{"id":"b"},{"id":"a"},{"id":"a"}]}')).toEqual(['a', 'b'])
    expect(parseModels('oops')).toEqual([])
    expect(parseCompletion('{"choices":[{"message":{"content":"<think>x</think> Hi "}}]}')).toBe('Hi')
    expect(errorReason(401, '{"error":{"message":"bad key"}}')).toBe('HTTP 401：bad key')
  })


  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}：常驻按钮打开面板，填写设置并选模型`, async ($, on) => {
      mock.clock(on)
      on('ui.toast', () => ({ value: undefined }))
      on('ui.status', () => ({ value: undefined }))
      on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'engine', scope: 'shared' as const }] }))
      const opened: string[] = []
      on('ui.open', (_$, e) => {
        opened.push(e.id)
        return { value: { isPlaced: true } }
      })
      on('ui.panes', () => ({ value: [] }))
      const calls: { url: string; auth?: string; session?: string; body?: string }[] = []
      on('http.fetch', (_$, e) => {
        calls.push({ url: e.url, auth: e.init?.headers?.Authorization, session: e.init?.headers?.['x-opencode-session'], body: e.init?.body })
        const text = e.url.endsWith('/models')
          ? '{"data":[{"id":"gpt-x"}]}'
          : '{"choices":[{"message":{"content":"Hello"}}]}'
        return { value: { status: 200, ok: true, headers: {}, text } }
      })
      const sent: string[] = []
      const contexts: (readonly string[] | undefined)[] = []
      on('prompt.submit', (_$, e) => {
        sent.push(e.text)
        contexts.push(e.context)
        return { text: e.text }
      })
      const stored: Record<string, unknown> = {}
      on('store.set', (_$, e) => {
        stored[e.key] = e.value
        return { value: undefined }
      })
      on('store.get', (_$, e) => ({ value: stored[e.key] }))
      on('session.id', () => ({ value: 'abc' }))
      on('ui.render', ($, e) => {
        const { Text } = $.ui.resolve(e)
        return <Text>engine</Text>
      })

      const button = await $.ui.mount({ plugin: 'translate-en', surface, ...BUTTON })
      expect((await button.find({ key: 'translate-toggle', text: '🌐' }))?.props.dimColor).toBe(true)
      await button.press({ key: 'translate-toggle' })
      expect(opened).toEqual([PANE])

      const pane = await $.ui.mount({ plugin: 'translate-en', surface, ...PANEL })
      // 只输入不点保存，点获取模型时也会先存下来
      await pane.input({ key: 'base', text: 'https://x.com/v1/', kind: 'change' })
      await pane.input({ key: 'key', text: 'sk-secret-123456', kind: 'change' })
      await pane.press({ key: 'fetch-models' })
      await pane.press({ key: 'm:gpt-x' })
      await pane.press({ key: 'enable' })
      expect(stored.config).toEqual({ enabled: true, baseUrl: 'https://x.com/v1', apiKey: 'sk-secret-123456', model: 'gpt-x', replyInChinese: true })
      expect((await button.find({ key: 'translate-toggle', text: '🌐' }))?.props.dimColor).toBe(false)

      // 用户发中文：先走自定义接口翻成英文
      await $.prompt.submit({ text: '你好', wait: false, origin: { kind: 'composer' } })
      expect(sent).toEqual(['Hello'])
      // 每条只附原文；固定说明在系统提示词里
      expect(contexts[0]).toEqual(['Original Chinese message (before machine translation):\n你好'])
      const composed = await $.prompt.compose(COMPOSE)
      expect(composed.sections.map(x => x.id)).toEqual(['intro', 'translate-en:learner'])
      expect(composed.sections[1]?.text).toContain('Reply to them in Simplified Chinese')
      const call = calls.find(c => c.url.endsWith('/chat/completions'))
      expect(call?.url).toBe('https://x.com/v1/chat/completions')
      expect(call?.auth).toBe('Bearer sk-secret-123456')
      expect(call?.session).toBe('translate-en-abc')
      expect(JSON.parse(call?.body ?? '{}').model).toBe('gpt-x')

      // 纯英文、斜杠命令、非用户来源都不翻
      await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
      await $.prompt.submit({ text: '后台通知', wait: false, origin: { kind: 'task-notification' } } as never)
      expect(sent).toEqual(['Hello', 'hello', '后台通知'])
      expect(contexts[1]).toBeUndefined()

      // 关掉「用中文回复」就只发译文
      await pane.press({ key: 'reply-zh' })
      await $.prompt.submit({ text: '再见', wait: false, origin: { kind: 'composer' } })
      expect(sent[3]).toBe('Hello')
      expect(contexts[3]).toBeUndefined()
      expect((await $.prompt.compose(COMPOSE)).sections.map(x => x.id)).toEqual(['intro'])
    })
  }

  test('以存下的配置为准；翻译超时就照原文发送', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on, { config: { enabled: true, baseUrl: 'https://x.com/v1', apiKey: 'k', model: 'm', replyInChinese: true } })
    on('session.id', () => ({ value: 'abc' }))
    const toasts: string[] = []
    on('ui.toast', (_$, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('ui.status', () => ({ value: undefined }))
    // 接口一直不返回
    on('http.fetch', () => new Promise(() => {}))
    const sent: string[] = []
    on('prompt.submit', (_$, e) => {
      sent.push(e.text)
      return { text: e.text }
    })
    // 没有跑 session.start，界面状态是默认的「关闭」，但存的配置是开启：照样要去翻译
    const pending = $.prompt.submit({ text: '你好', wait: false, origin: { kind: 'composer' } })
    await clock.advance(9000)
    await pending
    expect(sent).toEqual(['你好'])
    expect(toasts.some(t => t.includes('翻译失败，已发送原文') && t.includes('9 秒'))).toBe(true)
  })
})
