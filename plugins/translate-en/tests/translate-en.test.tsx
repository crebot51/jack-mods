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
      expect(stored.config).toEqual({ enabled: true, baseUrl: 'https://x.com/v1', apiKey: 'sk-secret-123456', model: 'gpt-x', provider: 'openai', chatgptModel: '', chatgptEmail: '' })
      expect((await button.find({ key: 'translate-toggle', text: '🌐' }))?.props.dimColor).toBe(false)

      // 用户发中文：先走自定义接口翻成英文
      await $.prompt.submit({ text: '你好', wait: false, origin: { kind: 'composer' } })
      expect(sent).toEqual(['Hello'])
      // 每条只附原文；固定说明在系统提示词里
      // 不附原文
      expect(contexts[0]).toBeUndefined()
      const composed = await $.prompt.compose(COMPOSE)
      expect(composed.sections.map(x => x.id)).toEqual(['intro', 'translate-en:learner'])
      expect(composed.sections[1]?.text).toContain('Reply to them in Simplified Chinese')
      // 系统提示词里只说想学中文，不提翻译和中文输入
      expect(composed.sections[1]?.text).toContain('American who wants to learn Chinese')
      expect(composed.sections[1]?.text).not.toMatch(/translat|type|original/i)
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

  test('ChatGPT 订阅：凭证从钥匙串读，走 Responses API 翻译', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const creds = { clientId: 'oaiapp_1', sub: 's', email: 'a@b.c', idToken: 'i', accessToken: 'AT', refreshToken: 'RT', expiresAt: 1_000_000 + 3_600_000, scopes: ['chatgpt.tokens.use.direct'] }
    const blob = btoa(JSON.stringify(creds)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    mock.store(on, { config: { enabled: true, baseUrl: '', apiKey: '', model: '', provider: 'chatgpt', chatgptModel: 'gpt-6-luna', chatgptEmail: 'a@b.c' } })
    const argvs: string[][] = []
    on('process.run', (_$, e) => {
      argvs.push([...e.argv])
      return { value: { exitCode: 0, stdout: e.argv[1] === 'find-generic-password' ? `${blob}\n` : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const calls: { url: string; auth?: string; body?: string }[] = []
    on('http.fetch', (_$, e) => {
      calls.push({ url: e.url, auth: e.init?.headers?.Authorization, body: e.init?.body })
      const text = 'data: {"type":"response.output_text.delta","delta":"Hello"}\n\ndata: {"type":"response.completed"}\n\n'
      return { value: { status: 200, ok: true, headers: {}, text } }
    })
    on('ui.toast', () => ({ value: undefined }))
    on('ui.status', () => ({ value: undefined }))
    const sent: string[] = []
    on('prompt.submit', (_$, e) => {
      sent.push(e.text)
      return { text: e.text }
    })
    await $.prompt.submit({ text: '你好', wait: false, origin: { kind: 'composer' } })
    expect(sent).toEqual(['Hello'])
    expect(argvs[0]).toEqual(['security', 'find-generic-password', '-s', 'claude-translate-en', '-a', 'chatgpt', '-w'])
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/responses')
    expect(calls[0]?.auth).toBe('Bearer AT')
    const body = JSON.parse(calls[0]?.body ?? '{}')
    expect(body.model).toBe('gpt-6-luna')
    expect(body.store).toBe(false)
    expect(body.stream).toBe(true)
    expect(body.temperature).toBeUndefined()
  })

  test('斜杠命令：技能和 /compact 的参数翻译，/model 这类内置命令不翻', async ($, on) => {
    mock.clock(on)
    mock.store(on, { config: { enabled: true, baseUrl: 'https://x.com/v1', apiKey: 'k', model: 'm', provider: 'openai' } })
    on('session.id', () => ({ value: 'abc' }))
    on('ui.toast', () => ({ value: undefined }))
    on('ui.status', () => ({ value: undefined }))
    on('command.list', () => ({ value: [
      { name: 'review-pr', description: '', source: 'plugin' },
      { name: 'compact', description: '', source: 'builtin' },
      { name: 'model', description: '', source: 'builtin' },
    ] }))
    on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{"choices":[{"message":{"content":"check the login logic"}}]}' } }))
    const ran: string[] = []
    on('command.run', (_$, e) => {
      ran.push(`${e.command}|${e.args}`)
      return { text: '' }
    })
    const presentation = { layout: 'main', columns: 80 } as never
    await $.command.run({ command: 'review-pr', args: '帮我看看登录逻辑', origin: { kind: 'composer' }, presentation })
    await $.command.run({ command: 'compact', args: '保留数据库相关的讨论', origin: { kind: 'composer' }, presentation })
    await $.command.run({ command: 'model', args: '小模型', origin: { kind: 'composer' }, presentation })
    await $.command.run({ command: 'review-pr', args: 'PR 123', origin: { kind: 'composer' }, presentation })
    expect(ran).toEqual(['review-pr|check the login logic', 'compact|check the login logic', 'model|小模型', 'review-pr|PR 123'])
  })

})
