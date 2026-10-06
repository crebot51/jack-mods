import { describe, expect, test } from 'claude-code/testing'

import { PANE, guessLang, t, cells, fitsOneLine, chipSvg, parseTranslations, zhKey, clip, favorites, filter, isCurrentModel, parseOptions } from '../hooks/register'

const HINT = { component: 'SessionMode', props: { modes: [] } } as const
const PANEL = { component: 'Pane', requestId: PANE,
  props: { title: '快捷命令', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

const LIST = [
  { name: 'clear', description: 'Clear conversation', source: 'builtin' },
  { name: 'compact', description: 'Compact conversation', source: 'builtin' },
  { name: 'foo', description: 'x'.repeat(60), source: 'user' },
] as const

describe('quick-commands', () => {
  test('常用命令按固定顺序；搜索按名字优先', async () => {
    expect(favorites(LIST).map(c => c.name)).toEqual(['compact', 'clear'])
    expect(filter(LIST, '/comp').map(c => c.name)).toEqual(['compact'])
    expect(filter(LIST, 'conversation').map(c => c.name)).toEqual(['clear', 'compact'])
    expect(filter(LIST, '').length).toBe(3)
    expect(clip('abcdef', 4)).toBe('abc…')
    expect(clip('abc', 4)).toBe('abc')
  })

  test('从命令输出里学参数可选值；当前模型高亮', async () => {
    expect(parseOptions('Usage: /model <name>. Available: sonnet, opus, opus[1m], or a full model ID.'))
      .toEqual(['sonnet', 'opus', 'opus[1m]'])
    expect(parseOptions('nothing here')).toEqual([])
    expect(isCurrentModel('claude-opus-5-5', 'opus')).toBe(true)
    expect(isCurrentModel('claude-opus-5-5', 'opus[1m]')).toBe(false)
    expect(isCurrentModel('claude-opus-5-5[1m]', 'opus[1m]')).toBe(true)
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}：点按钮打开面板，点命令执行并收起`, async ($, on) => {
      const ran: string[] = []
      on('command.list', () => ({ value: [...LIST] }))
      on('command.run', (_$, e) => {
        ran.push(e.command)
        return { text: '' }
      })
      const opened: string[] = []
      on('ui.open', (_$, e) => {
        opened.push(e.id)
        return { value: { isPlaced: true } }
      })
      on('ui.close', () => ({ value: undefined }))
      on('ui.panes', () => ({ value: [] }))
      on('session.model', () => ({ value: 'claude-opus-5-5' }))
      on('settings.read', () => ({ value: {} }))
      on('env.get', () => ({ value: undefined }))
      on('ui.render', ($, e) => {
        const { Text } = $.ui.resolve(e)
        return <Text>engine</Text>
      })

      const hint = await $.ui.mount({ plugin: 'quick-commands', surface, ...HINT })
      await hint.press({ key: 'toggle' })
      expect(opened).toEqual([PANE])

      const pane = await $.ui.mount({ plugin: 'quick-commands', surface, ...PANEL })
      expect(await pane.find({ key: 'cmd:compact' })).toBeDefined()
      await pane.press({ key: 'cmd:compact' })
      expect(ran).toEqual(['compact'])

      await pane.unmount()
      await hint.unmount()
    })
  }

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}：122 个命令也能画出来，搜索能筛选`, async ($, on) => {
      const many = Array.from({ length: 122 }, (_, i) => ({
        name: `cmd${i}`,
        description: `说明 ${i} `.repeat(10),
        source: (['builtin', 'plugin', 'user', 'mcp'] as const)[i % 4] ?? 'builtin',
      }))
      on('command.list', () => ({ value: many }))
      on('session.model', () => ({ value: 'claude-opus-5-5' }))
      on('settings.read', () => ({ value: {} }))
      on('env.get', () => ({ value: undefined }))
      on('ui.open', () => ({ value: { isPlaced: true } }))
      on('ui.panes', () => ({ value: [] }))
      on('ui.render', ($, e) => {
        const { Text } = $.ui.resolve(e)
        return <Text>engine</Text>
      })

      const hint = await $.ui.mount({ plugin: 'quick-commands', surface, ...HINT })
      await hint.press({ key: 'toggle' })
      const pane = await $.ui.mount({ plugin: 'quick-commands', surface, ...PANEL })
      expect(await pane.find({ key: 'cmd:cmd0' })).toBeDefined()
      expect(await pane.find({ key: 'cmd:cmd121' })).toBeDefined()

      await pane.input({ key: 'search', text: 'cmd121', kind: 'change' })
      expect(await pane.find({ key: 'cmd:cmd121' })).toBeDefined()
      expect(await pane.find({ key: 'cmd:cmd0' })).toBeUndefined()

      await pane.unmount()
      await hint.unmount()
    })
  }

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}：没见过选项的命令先执行并学选项，再点选项；设置页点开关`, async ($, on) => {
      const ran: string[] = []
      const sets: unknown[] = []
      let verbose = false
      on('command.list', () => ({ value: [{ name: 'status', description: 'Show status', source: 'builtin' as const }] }))
      on('command.run', (_$, e) => {
        ran.push(`${e.command} ${e.args}`)
        return { text: e.args ? 'ok' : 'Usage: /status <x>. Available: a, b' }
      })
      on('session.model', () => ({ value: 'claude-opus-5-5' }))
      on('settings.read', () => ({ value: {} }))
      on('env.get', () => ({ value: undefined }))
      on('store.set', () => ({ value: undefined }))
      on('config.list', () => ({
        value: [
          { key: 'verbose', label: 'Verbose', kind: 'boolean' as const, value: verbose, provider: { plugin: 'engine', tier: 'core' as const }, isLocked: false },
          { key: 'theme', label: 'Theme', kind: 'choice' as const, value: 'dark', options: ['dark', 'light'], provider: { plugin: 'engine', tier: 'core' as const }, isLocked: false },
        ],
      }))
      on('config.set', (_$, e) => {
        sets.push([e.key, e.value])
        if (e.key === 'verbose') verbose = e.value === true
        return { value: e.value }
      })
      on('ui.open', () => ({ value: { isPlaced: true } }))
      on('ui.close', () => ({ value: undefined }))
      on('ui.panes', () => ({ value: [] }))
      on('ui.render', ($, e) => {
        const { Text } = $.ui.resolve(e)
        return <Text>engine</Text>
      })

      const hint = await $.ui.mount({ plugin: 'quick-commands', surface, ...HINT })
      await hint.press({ key: 'toggle' })
      const pane = await $.ui.mount({ plugin: 'quick-commands', surface, ...PANEL })

      await pane.press({ key: 'cmd:status' })
      expect(await pane.find({ key: 'opt:b' })).toBeDefined()
      await pane.press({ key: 'opt:b' })
      expect(ran).toEqual(['status ', 'status b'])

      await pane.press({ key: 'tab:settings' })
      await pane.press({ key: 'set:verbose:on' })
      await pane.press({ key: 'set:theme:light' })
      expect(sets).toEqual([['verbose', true], ['theme', 'light']])

      await pane.unmount()
      await hint.unmount()
    })
  }
})

describe('quick-commands 语言', () => {
  test('中英文案、占位替换；缺的 key 退回英文再退回 key', async () => {
    expect(t('zh', 'tab.settings')).toBe('设置')
    expect(t('en', 'tab.settings')).toBe('Settings')
    expect(t('en', 'notice.changed', 'Verbose', 'On')).toBe('Changed "Verbose" to On')
    expect(t('zh', 'run.bare', 'x')).toBe('不带参数执行 /x')
    expect(t('en', 'no-such-key')).toBe('no-such-key')
  })

  test('自动判断：settings 的 language 优先，其次系统语言，都没有当中文', async () => {
    expect(guessLang('English', 'zh_CN.UTF-8')).toBe('en')
    expect(guessLang('简体中文', 'en_US.UTF-8')).toBe('zh')
    expect(guessLang('Chinese', undefined)).toBe('zh')
    expect(guessLang(undefined, 'en_US.UTF-8')).toBe('en')
    expect(guessLang(undefined, 'zh_CN.UTF-8')).toBe('zh')
    expect(guessLang(undefined, 'C')).toBe('zh')
    expect(guessLang(undefined, undefined)).toBe('zh')
  })
})

describe('quick-commands 设置排版', () => {
  test('一行放得下就和名字同排，放不下才折行', async () => {
    expect(cells('自动压缩')).toBe(8)
    expect(cells('small')).toBe(5)
    expect(fitsOneLine('自动压缩', ['开', '关'], 43)).toBe(true)
    expect(fitsOneLine('动态工作流大小', ['unrestricted', 'small', 'medium', 'large'], 43)).toBe(false)
    expect(fitsOneLine('消息被标记时切换模型', ['Switch automatically', 'Ask each time'], 43)).toBe(false)
  })
})

describe('quick-commands 选中标签', () => {
  test('蓝底标签的尺寸跟文字走，特殊字符被转义', async () => {
    const one = chipSvg('开')
    expect(one.height).toBe(23)
    expect(one.width).toBe(13 + 17)
    expect(chipSvg('ab').width).toBe(Math.ceil(13.2) + 17)
    expect(chipSvg('a<b&c').source).toContain('a&lt;b&amp;c')
  })
})

describe('quick-commands 翻译', () => {
  test('解析模型回复里的 JSON，忽略多余文字和坏数据', async () => {
    expect(parseTranslations('好的：{"0":"压缩对话","1":" 清空 ","2":5}')).toEqual({ '0': '压缩对话', '1': '清空' })
    expect(parseTranslations('没有 json')).toEqual({})
    expect(parseTranslations('{坏的}')).toEqual({})
    expect(zhKey('cmd:a', 'Hi')).toBe('cmd:a|Hi')
  })
})

describe('quick-commands 技能命令', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}：点技能命令只填进输入框，不执行`, async ($, on) => {
      const filled: string[] = []
      let ran = 0
      on('command.list', () => ({ value: [{ name: 'dataviz', description: 'chart skill', source: 'builtin' as const }] }))
      on('command.run', () => { ran++; return { text: '' } })
      on('prompt.fill', (_$, e) => { filled.push(e.text); return { isFilled: true } })
      on('session.model', () => ({ value: 'm' }))
      on('settings.read', () => ({ value: {} }))
      on('env.get', () => ({ value: undefined }))
      on('config.list', () => ({ value: [] }))
      on('ui.open', () => ({ value: { isPlaced: true } }))
      on('ui.close', () => ({ value: undefined }))
      on('ui.panes', () => ({ value: [] }))
      on('ui.render', ($, e) => {
        const { Text } = $.ui.resolve(e)
        return <Text>engine</Text>
      })
      const hint = await $.ui.mount({ plugin: 'quick-commands', surface, ...HINT })
      await hint.press({ key: 'toggle' })
      const pane = await $.ui.mount({ plugin: 'quick-commands', surface, ...PANEL })
      await pane.press({ key: 'cmd:dataviz' })
      expect(filled).toEqual(['/dataviz '])
      expect(ran).toBe(0)
      expect(await pane.find({ key: 'args:cmd:dataviz' })).toBeUndefined()
      await pane.unmount()
      await hint.unmount()
    })
  }
})

describe('quick-commands 语言切换按钮', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}：点一下在 自动 → 中文 → English 之间轮换，并记住`, async ($, on) => {
      const saved: unknown[] = []
      on('command.list', () => ({ value: [{ name: 'compact', description: 'Compact', source: 'builtin' as const }] }))
      on('session.model', () => ({ value: 'm' }))
      on('settings.read', () => ({ value: { language: 'English' } }))
      on('env.get', () => ({ value: undefined }))
      on('config.list', () => ({ value: [] }))
      on('store.set', (_$, e) => { saved.push(e.value); return { value: undefined } })
      on('model.complete', () => ({ value: { isAnswered: false, reason: 'aborted' } as never }))
      on('ui.open', () => ({ value: { isPlaced: true } }))
      on('ui.close', () => ({ value: undefined }))
      on('ui.panes', () => ({ value: [] }))
      on('ui.render', ($, e) => {
        const { Text } = $.ui.resolve(e)
        return <Text>engine</Text>
      })
      const hint = await $.ui.mount({ plugin: 'quick-commands', surface, ...HINT })
      await hint.press({ key: 'toggle' })
      const pane = await $.ui.mount({ plugin: 'quick-commands', surface, ...PANEL })
      expect(await pane.find({ key: 'lang' })).toBeDefined()
      await pane.press({ key: 'lang' })
      await pane.press({ key: 'lang' })
      await pane.press({ key: 'lang' })
      expect(saved).toEqual(['zh', 'en', 'auto'])
      await pane.unmount()
      await hint.unmount()
    })
  }
})
