import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Lang, LangPref, QuickCommand, RunMode, SettingRow, Tab } from '../types'

const isOpen = atom({ plugin: 'quick-commands', key: 'isOpen' } as const, false)
const commands = atom({ plugin: 'quick-commands', key: 'commands' } as const, [] as QuickCommand[])
const mode = atom({ plugin: 'quick-commands', key: 'mode' } as const, 'run' as RunMode)
const query = atom({ plugin: 'quick-commands', key: 'query' } as const, '')
const tab = atom({ plugin: 'quick-commands', key: 'tab' } as const, 'commands' as Tab)
const detail = atom({ plugin: 'quick-commands', key: 'detail' } as const, null as string | null)
const zh = atom({ plugin: 'quick-commands', key: 'zh' } as const, {} as Record<string, string>)
const langPref = atom({ plugin: 'quick-commands', key: 'langPref' } as const, 'auto' as LangPref)
const langAuto = atom({ plugin: 'quick-commands', key: 'langAuto' } as const, 'zh' as Lang)
const learned = atom({ plugin: 'quick-commands', key: 'learned' } as const, {} as Record<string, string[]>)
const settings = atom({ plugin: 'quick-commands', key: 'settings' } as const, [] as SettingRow[])
const model = atom({ plugin: 'quick-commands', key: 'model' } as const, '')
const notice = atom({ plugin: 'quick-commands', key: 'notice' } as const, '')

/** 命令面板的 id */
export const PANE = 'quick-commands'

/** 面板顶部的常用命令，按这个顺序；当前会话没有的自动跳过 */
export const FAVORITES = ['compact', 'clear', 'context', 'cost', 'resume', 'review', 'init']

/** 内置命令的参数可选值；其余命令从执行输出里的「Available: a, b, c」学 */
export const KNOWN_OPTIONS: Record<string, string[]> = {}

/** 桌面端自己的选择器能改的，不再做参数页，也不去学 */
const SKIP_LEARN = new Set(['model', 'effort'])

/** 选中项的底色：Claude 设置页里开关的蓝 */
const BLUE = '#3d73d4'

const CHIP_HEIGHT = 23
const CHIP_PAD = 17

/** 画一个和原生按钮一样大的蓝底圆角标签：高 23，左右各约 8.5 的内边距，字号 13 */
export function chipSvg(label: string): { source: string; width: number; height: number } {
  let text = 0
  for (const ch of label) text += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 13 : 6.6
  const textWidth = Math.ceil(text)
  const width = textWidth + CHIP_PAD
  const safe = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${CHIP_HEIGHT}" viewBox="0 0 ${width} ${CHIP_HEIGHT}">` +
    `<rect width="${width}" height="${CHIP_HEIGHT}" rx="6" fill="${BLUE}"/>` +
    `<text x="${width / 2}" y="${CHIP_HEIGHT / 2 + 0.5}" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',sans-serif" font-size="13" fill="#ffffff" ` +
    `textLength="${textWidth}" lengthAdjust="spacingAndGlyphs">${safe}</text></svg>`
  return { source, width, height: CHIP_HEIGHT }
}

/** 点一下就该直接执行的内置命令（不需要再打参数） */
export const DIRECT = new Set([
  'compact', 'clear', 'context', 'cost', 'status', 'usage', 'help', 'doctor', 'resume', 'export', 'copy',
  'rewind', 'mcp', 'agents', 'hooks', 'permissions', 'config', 'memory', 'login', 'logout', 'vim', 'theme',
])

/** 界面文字的中英对照；{0}、{1} 是占位 */
const STRINGS: Record<Lang, Record<string, string>> = {
  zh: {
    'group.builtin': '内置', 'group.user': '我的命令', 'group.plugin': '插件 / Skill', 'group.mcp': 'MCP',
    on: '开', off: '关',
    'pane.title': '快捷命令',
    'toast.openFail': '快捷命令面板没能打开：{0}',
    'toast.slow': '/{0} 还在执行，完成后会显示结果',
    'toast.translateFail': '翻译没成功：{0}',
    'toast.translateError': '翻译出错：{0}',
    'chip.selected': '（已选中）',
    'tab.commands': '命令', 'tab.settings': '设置',
    'notice.failed': '「{0}」没改成：{1}', 'notice.changed': '已把「{0}」改成 {1}',
    save: '保存', 'settings.none': '没有可改的设置',
    back: '← 返回', 'args.placeholder': '其他参数，回车执行', run: '执行', 'run.bare': '不带参数执行 /{0}',
    'search.placeholder': '搜索 {0} 个命令，回车执行第一个',
    hint: '常用内置命令直接执行（⋯ 手动填参数）；其余点一下只填进输入框',
    favorites: '常用', 'commands.none': '没有匹配的命令',
    'lang.auto': '自动 · {0}', 'lang.zh': '中文', 'lang.en': 'English',
  },
  en: {
    'group.builtin': 'Built-in', 'group.user': 'My commands', 'group.plugin': 'Plugins & skills', 'group.mcp': 'MCP',
    on: 'On', off: 'Off',
    'pane.title': 'Quick commands',
    'toast.openFail': "Couldn't open the Quick commands panel: {0}",
    'toast.slow': '/{0} is still running; the result will show when it finishes',
    'toast.translateFail': 'Translation failed: {0}',
    'toast.translateError': 'Translation error: {0}',
    'chip.selected': ' (selected)',
    'tab.commands': 'Commands', 'tab.settings': 'Settings',
    'notice.failed': 'Couldn\'t change "{0}": {1}', 'notice.changed': 'Changed "{0}" to {1}',
    save: 'Save', 'settings.none': 'No settings to change',
    back: '← Back', 'args.placeholder': 'Other arguments, Enter to run', run: 'Run', 'run.bare': 'Run /{0} without arguments',
    'search.placeholder': 'Search {0} commands, Enter runs the first',
    hint: 'Common built-ins run right away (⋯ to add arguments); the rest just fill the input box',
    favorites: 'Favorites', 'commands.none': 'No matching commands',
    'lang.auto': 'Auto · {0}', 'lang.zh': '中文', 'lang.en': 'English',
  },
}

/** 取一条界面文字，把 {0}、{1} 换成参数 */
export function t(lang: Lang, key: string, ...args: (string | number)[]): string {
  const text = STRINGS[lang][key] ?? STRINGS.en[key] ?? key
  return text.replace(/\{(\d)\}/g, (_, i: string) => String(args[Number(i)] ?? ''))
}

/** 从 settings.json 的 language（Claude 回复语言）或系统语言猜界面语言；都没有就当中文 */
export function guessLang(setting: string | undefined, locale: string | undefined): Lang {
  const s = (setting ?? '').trim()
  if (s) return /chin|中文|汉|漢|^zh/i.test(s) ? 'zh' : 'en'
  const l = (locale ?? '').trim()
  if (l && l !== 'C' && l !== 'POSIX') return /^zh/i.test(l) ? 'zh' : 'en'
  return 'zh'
}

/** 当前界面语言：手动选的优先，否则用自动判断的 */
async function currentLang($: EngineInterface): Promise<Lang> {
  const pref = await read($, langPref)
  return pref === 'auto' ? await read($, langAuto) : pref
}

/** 分组顺序和名字 */
const GROUPS: { source: string; title: string }[] = [
  { source: 'builtin', title: 'group.builtin' },
  { source: 'user', title: 'group.user' },
  { source: 'plugin', title: 'group.plugin' },
  { source: 'mcp', title: 'group.mcp' },
]

/** 常用命令（按 FAVORITES 顺序） */
export function favorites(all: readonly QuickCommand[]): QuickCommand[] {
  const byName = new Map(all.map(c => [c.name, c]))
  return FAVORITES.flatMap(n => byName.get(n) ?? [])
}

/** 按关键字筛选：命令名或说明里包含即可，不分大小写；命令名开头匹配的排前面 */
export function filter(all: readonly QuickCommand[], q: string): QuickCommand[] {
  const k = q.trim().replace(/^\//, '').toLowerCase()
  if (!k) return [...all]
  const hits = all.filter(
    c => c.name.toLowerCase().includes(k) || c.description.toLowerCase().includes(k),
  )
  const rank = (c: QuickCommand) =>
    c.name.toLowerCase().startsWith(k) ? 0 : c.name.toLowerCase().includes(k) ? 1 : 2
  return hits.sort((a, b) => rank(a) - rank(b))
}

/** 把说明截到 n 个字以内 */
export function clip(text: string, n: number): string {
  if (n <= 1) return ''
  return text.length > n ? `${text.slice(0, n - 1)}…` : text
}

/**
 * 从命令输出里找参数可选值，例如
 * 「Usage: /model <name>. Available: sonnet, opus, haiku, or a full model ID.」
 * 只留不带空格的值（去掉「or a full model ID」这类说明）
 */
export function parseOptions(text: string | undefined): string[] {
  const m = text?.match(/Available(?: values| options)?:\s*([^\n]+)/i)
  if (!m?.[1]) return []
  return m[1]
    .replace(/\.\s*$/, '')
    .split(/,\s*/)
    .map(s => s.trim().replace(/^or\s+/, '').replace(/[`'"]/g, ''))
    .filter(s => s.length > 0 && !/\s/.test(s))
}

/** 当前模型是否就是这个选项（模型 id 里含有选项名即算） */
export function isCurrentModel(current: string, option: string): boolean {
  if (!current) return false
  const base = option.replace(/\[1m\]$/, '')
  const has1m = option.endsWith('[1m]')
  return current.includes(base) && current.includes('[1m]') === has1m
}

/** 文字占几个字符格：中文、全角算 2 */
export function cells(text: string): number {
  let n = 0
  for (const ch of text) n += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1
  return n
}

/** 名字和一排选项能不能放进同一行（每个选项按文字宽 + 左右内边距和间距估 4 格） */
export function fitsOneLine(label: string, options: readonly string[], columns: number): boolean {
  const controls = options.reduce((sum, o) => sum + cells(o) + 4, 0)
  return cells(label) + 2 + controls <= columns - 2
}

/** 设置项的值显示成文字 */
export function showValue(v: SettingRow['value'], lang: Lang = 'zh'): string {
  if (typeof v === 'boolean') return t(lang, v ? 'on' : 'off')
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}

/** 重新拉取当前会话可用的斜杠命令和当前模型 */
async function refresh($: EngineInterface) {
  const list = await $.command.list()
  await update($, commands, () =>
    list.map(c => ({ name: c.name, description: c.description, source: c.source })),
  )
  const current = await $.session.model()
  await update($, model, () => current)
  const conf = (await $.settings.read()) as { language?: string }
  const locale = (await $.env.get('LC_ALL')) || (await $.env.get('LANG'))
  const guessed = guessLang(conf.language, locale)
  await update($, langAuto, () => guessed)
}

const hasCJK = (text: string) => /[\u4e00-\u9fff]/.test(text)

/** 译文缓存的 key：原文变了就重新翻 */
export const zhKey = (id: string, text: string) => `${id}|${text}`

/** 从模型回复里取出 {"0":"译文",...} */
export function parseTranslations(text: string): Record<string, string> {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return {}
  try {
    const obj = JSON.parse(m[0]) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(obj)) if (typeof v === 'string' && v.trim()) out[k] = v.trim()
    return out
  } catch {
    return {}
  }
}

let translating = false

/** 把还没有中文的命令说明、设置名和说明批量翻成中文，存起来；失败就静默，界面继续显示英文 */
async function translate($: EngineInterface) {
  if (translating || (await currentLang($)) !== 'zh') return
  translating = true
  try {
    let next = await read($, zh)
    // 模型偶尔漏回几条，所以缺的接着再翻，最多 3 轮，一轮没有进展就停
    for (let round = 0; round < 3; round++) {
      const have = next
      const items: { id: string; text: string }[] = []
      for (const c of await read($, commands)) {
        if (c.description && !hasCJK(c.description)) items.push({ id: `cmd:${c.name}`, text: c.description })
      }
      for (const r of await read($, settings)) {
        if (r.label && !hasCJK(r.label)) items.push({ id: `label:${r.key}`, text: r.label })
        if (r.description && !hasCJK(r.description)) items.push({ id: `desc:${r.key}`, text: r.description })
      }
      const todo = items.filter(i => !have[zhKey(i.id, i.text)])
      for (let i = 0; i < todo.length; i += 20) {
        const chunk = todo.slice(i, i + 20)
        const prompt =
          '把下面 JSON 数组里每条说明翻译成简体中文：简短通顺，不超过 40 字，命令名、代码、专有名词保持原样。' +
          '只输出一个 JSON 对象，键是序号，值是译文，不要别的文字。\n' +
          JSON.stringify(chunk.map((c, n) => ({ n: String(n), text: c.text.slice(0, 400) })))
        const r = await $.model.complete({ model: 'haiku', prompt, maxTokens: 4096 })
        if (!r.isAnswered) {
          $.ui.toast(t(await currentLang($), 'toast.translateFail', r.reason))
          break
        }
        const got = parseTranslations(r.text)
        const added: Record<string, string> = {}
        chunk.forEach((c, n) => {
          const t = got[String(n)]
          if (t) added[zhKey(c.id, c.text)] = t
        })
        next = { ...next, ...added }
        await update($, zh, () => next)
        await $.store.set('zh', next)
      }
      if (todo.length === 0 || Object.keys(next).length === Object.keys(have).length) break
    }
  } catch (err) {
    // 翻译只是锦上添花，只提示一下，不影响使用
    $.ui.toast(t(await currentLang($), 'toast.translateError', err instanceof Error ? err.message : String(err)))
  } finally {
    translating = false
  }
}

/** 重新拉取 /config 的设置项 */
async function refreshSettings($: EngineInterface) {
  const rows = await $.config.list()
  await update($, settings, () =>
    rows.map(r => ({
      key: r.key,
      label: r.label,
      description: r.description,
      kind: r.kind,
      value: r.value,
      options: r.options,
      isLocked: r.isLocked,
    })),
  )
}

/** 打开面板；detailName 给了就直接进那个命令的参数页 */
async function openPane($: EngineInterface, detailName: string | null) {
  await update($, detail, () => detailName)
  const opened = await $.ui.open({ id: PANE, title: t(await currentLang($), 'pane.title'), focus: true, closeOnEscape: true, rows: 14 })
  if (opened.isPlaced) {
    await update($, isOpen, () => true)
  } else {
    $.ui.toast(t(await currentLang($), 'toast.openFail', opened.reason))
  }
}

/** 执行 /name args；执行后发现命令列出了可选值，就记下来并打开它的参数页 */
async function runCommand($: EngineInterface, name: string, args: string) {
  const text = args ? `/${name} ${args}` : `/${name}`
  await $.ui.close({ id: PANE })
  if ((await read($, mode)) === 'fill') {
    await $.prompt.fill({ text: args ? text : `${text} ` })
    return
  }
  let output: string | undefined
  try {
    // 像 /compact 这种要跑很久的命令，不等它跑完，免得超过 hook 的 10 秒预算
    const slow = Symbol('slow')
    const ran = await Promise.race([
      $.command.run({ command: name, args }),
      $.clock.sleep(6000).then(() => slow, () => new Promise<never>(() => {})),
    ])
    if (ran === slow) {
      $.ui.toast(t(await currentLang($), 'toast.slow', name))
      return
    }
    output = (ran as { text: string }).text
  } catch {
    // 有些命令不能从插件直接执行，退回到填进输入框
    await $.prompt.fill({ text: `${text} ` })
    return
  }
  const options = parseOptions(output)
  if (!args && options.length > 0 && !SKIP_LEARN.has(name)) {
    const next = { ...(await read($, learned)), [name]: options }
    await update($, learned, () => next)
    await $.store.set('learned', next)
    await openPane($, name)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await update($, isOpen, () => false)
    await update($, detail, () => null)
    const saved = await $.store.get('learned')
    if (saved && typeof saved === 'object') {
      await update($, learned, () => saved as Record<string, string[]>)
    }
    const savedLang = await $.store.get('langPref')
    if (savedLang === 'zh' || savedLang === 'en' || savedLang === 'auto') {
      await update($, langPref, () => savedLang)
    }
    const savedZh = await $.store.get('zh')
    if (savedZh && typeof savedZh === 'object') {
      await update($, zh, () => savedZh as Record<string, string>)
    }
    await refresh($)
    void translate($)
    return result
  })

  // 面板被关掉（点面板的关闭、按 Esc、或我们自己关）时同步按钮状态
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const result = await next(e)
    await update($, isOpen, () => false)
    // 桌面端手动关掉面板时，底部按钮不一定跟着重画，主动要一次
    $.ui.invalidate('ui.render')
    return result
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const engine = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    // 以引擎里面板的实际状态为准，自己记的状态只用来触发重画
    const open = (await read($, isOpen)) && (await $.ui.panes()).some(p => p.id === PANE)

    return (
      <Box>
        {engine}
        <Button
          key="toggle"
          label={open ? '✕' : '⚡'}
          plain
          dimColor={!open}
          onPress={async () => {
            const isUp = (await $.ui.panes()).some(p => p.id === PANE)
            if (open || isUp) {
              if (isUp) await $.ui.close({ id: PANE })
              await update($, isOpen, () => false)
              return
            }
            await refresh($)
            await update($, query, () => '')
            await update($, notice, () => '')
            if ((await read($, tab)) === 'settings') await refreshSettings($)
            await openPane($, null)
            void translate($)
          }}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    // 手机端没有输入框
    const Input = 'Input' in els ? els.Input : undefined
    const Svg = 'Svg' in els ? els.Svg : undefined
    const width = e.props.bodyColumns
    const pref = await read($, langPref)
    const lang = await currentLang($)
    const tt = (key: string, ...args: (string | number)[]) => t(lang, key, ...args)
    const all = await read($, commands)
    const currentTab = await read($, tab)
    const detailName = await read($, detail)
    const learnedOptions = await read($, learned)
    const zhMap = await read($, zh)
    const zhOf = (id: string, text: string) => (lang === 'zh' ? zhMap[zhKey(id, text)] : undefined) ?? text
    const optionsOf = (name: string) => learnedOptions[name] ?? KNOWN_OPTIONS[name] ?? []

    // 选中的项画成蓝底白字（本来就不用再点），尺寸、圆角和旁边的原生按钮一样；没选中的才是按钮。
    // 桌面端没有能点的蓝色元素，所以用 Svg 画；没有 Svg 的界面（终端）退回浅灰按钮
    const chip = (key: string, label: string, selected: boolean, onPress: () => unknown) => {
      if (!selected) return <Button key={key} label={label} onPress={onPress} />
      if (!Svg) return <Button key={key} label={`● ${label}`} variant="secondary" onPress={onPress} />
      const { source, width: chipW, height: chipH } = chipSvg(label)
      return (
        <Box key={key}>
          <Svg source={source} alt={`${label}${tt('chip.selected')}`} width={chipW} height={chipH} />
        </Box>
      )
    }

    const tabs = (
      <Box flexDirection="row" columnGap={1}>
        {chip('tab:commands', tt('tab.commands'), currentTab === 'commands', async () => {
          await update($, tab, () => 'commands')
          await update($, detail, () => null)
        })}
        {chip('tab:settings', tt('tab.settings'), currentTab === 'settings', async () => {
          await refreshSettings($)
          void translate($)
          await update($, notice, () => '')
          await update($, tab, () => 'settings')
        })}
        <Button
          key="lang"
          label={`🌐 ${pref === 'auto' ? tt('lang.auto', tt(`lang.${lang}`)) : tt(`lang.${pref}`)}`}
          dimColor
          onPress={async () => {
            const nextPref: LangPref = pref === 'auto' ? 'zh' : pref === 'zh' ? 'en' : 'auto'
            await update($, langPref, () => nextPref)
            await $.store.set('langPref', nextPref)
            void translate($)
          }}
        />
      </Box>
    )

    // ── 设置页 ──
    if (currentTab === 'settings') {
      const rows = await read($, settings)
      const msg = await read($, notice)
      const set = async (row: SettingRow, value: SettingRow['value']) => {
        const result = await $.config.set({ key: row.key, value })
        const name = zhOf(`label:${row.key}`, row.label)
        await update($, notice, () =>
          'deny' in result && result.deny
            ? tt('notice.failed', name, String(result.deny))
            : tt('notice.changed', name, showValue(value, lang)),
        )
        await refreshSettings($)
        void translate($)
      }

      // 每个设置一行：名字在左，选项在右；选项太多放不下才折到名字下面
      const settingRow = (row: SettingRow) => {
        const label = zhOf(`label:${row.key}`, row.label)
        const title = <Text bold wrap="truncate-end">{label}</Text>
        const desc = row.description ? (
          <Text dimColor wrap="truncate-end">{clip(zhOf(`desc:${row.key}`, row.description), width - 2)}</Text>
        ) : null
        let controls: RenderChildren = null
        let options: readonly string[] = []
        if (row.isLocked) {
          controls = <Text dimColor>🔒 {showValue(row.value)}</Text>
          options = [showValue(row.value)]
        } else if (row.kind === 'boolean') {
          controls = (
            <Box flexDirection="row" columnGap={1}>
              {chip(`set:${row.key}:on`, tt('on'), row.value === true, () => set(row, true))}
              {chip(`set:${row.key}:off`, tt('off'), row.value === false, () => set(row, false))}
            </Box>
          )
          options = [tt('on'), tt('off')]
        } else if (row.kind === 'choice' && row.options) {
          controls = (
            <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={0}>
              {row.options.map(opt => chip(`set:${row.key}:${opt}`, opt, row.value === opt, () => set(row, opt)))}
            </Box>
          )
          options = row.options
        } else if (Input) {
          // 文字、数字：名字下面一个输入框
          return (
            <Box key={`setting:${row.key}`} flexDirection="column">
              {title}
              {desc}
              <Input
                key={`set:${row.key}:input`}
                value={showValue(row.value)}
                submitLabel={tt('save')}
                onSubmit={(v: string) => {
                  void set(row, row.kind === 'number' ? Number(v) : v)
                }}
              />
            </Box>
          )
        } else {
          controls = <Text dimColor>{showValue(row.value)}</Text>
          options = [showValue(row.value)]
        }
        const oneLine = fitsOneLine(label, options, width)
        return (
          <Box key={`setting:${row.key}`} flexDirection="column">
            {oneLine ? (
              <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1}>
                <Box flexShrink={1}>{title}</Box>
                <Box flexShrink={0}>{controls}</Box>
              </Box>
            ) : (
              <Box flexDirection="column">
                {title}
                {controls}
              </Box>
            )}
            {desc}
          </Box>
        )
      }

      return (
        <Box flexDirection="column" rowGap={1}>
          {tabs}
          {msg ? <Text dimColor>{msg}</Text> : null}
          {rows.length === 0 ? <Text dimColor>{tt('settings.none')}</Text> : null}
          <Box flexDirection="column">{rows.map(settingRow)}</Box>
        </Box>
      )
    }

    // ── 命令参数页 ──
    if (detailName) {
      const info = all.find(c => c.name === detailName)
      const options = optionsOf(detailName)
      const current = await read($, model)
      return (
        <Box flexDirection="column" rowGap={1}>
          {tabs}
          <Box flexDirection="row" columnGap={1}>
            <Button key="back" label={tt('back')} dimColor onPress={() => update($, detail, () => null)} />
            <Text bold>/{detailName}</Text>
          </Box>
          {info?.description ? <Text dimColor>{zhOf(`cmd:${info.name}`, info.description)}</Text> : null}
          {options.length > 0 ? (
            <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
              {options.map(opt => {
                const isCurrent = detailName === 'model' && isCurrentModel(current, opt)
                return chip(`opt:${opt}`, opt, isCurrent, () => runCommand($, detailName, opt))
              })}
            </Box>
          ) : null}
          {Input ? (
            <Input
              key="args"
              placeholder={tt('args.placeholder')}
              submitLabel={tt('run')}
              onSubmit={(v: string) => {
                void runCommand($, detailName, v.trim())
              }}
            />
          ) : null}
          <Button
            key="run-bare"
            label={tt('run.bare', detailName)}
            dimColor
            onPress={() => runCommand($, detailName, '')}
          />
        </Box>
      )
    }

    // ── 命令列表 ──
    const q = await read($, query)

    // 有可选值的命令点了进参数页，其余直接执行
    // 技能 / 插件 / MCP 命令几乎都要接自由文本，点一下只把 /名字 填进输入框，不执行
    // 打包进来的技能也可能被标成 builtin，所以只认下面这份「不用参数」的名单，其余都填输入框
    const isBuiltin = (name: string) =>
      DIRECT.has(name) && (all.find(c => c.name === name)?.source ?? 'builtin') === 'builtin'
    const press = async (name: string) => {
      if (!isBuiltin(name)) {
        await $.ui.close({ id: PANE })
        await $.prompt.fill({ text: `/${name} ` })
        return
      }
      if (optionsOf(name).length > 0) await update($, detail, () => name)
      else await runCommand($, name, '')
    }

    // 常用里的命令在分组里还会出现一次，key 用前缀区分
    const row = (prefix: string) => (c: QuickCommand) => (
      <Box key={`row:${prefix}:${c.name}`} flexDirection="row" columnGap={1}>
        <Box flexShrink={0} flexDirection="row">
          <Button
            key={`${prefix}:${c.name}`}
            label={optionsOf(c.name).length > 0 ? `/${c.name} ›` : `/${c.name}`}
            plain
            onPress={() => press(c.name)}
          />
          {isBuiltin(c.name) ? (
            <Button
              key={`args:${prefix}:${c.name}`}
              label="⋯"
              plain
              dimColor
              onPress={() => update($, detail, () => c.name)}
            />
          ) : null}
        </Box>
        <Text dimColor wrap="truncate-end">
          {clip(zhOf(`cmd:${c.name}`, c.description), width - c.name.length - 6)}
        </Text>
      </Box>
    )

    const hits = filter(all, q)
    const groups = GROUPS.map(g => ({
      ...g,
      items: hits.filter(c => (c.source ?? 'builtin') === g.source),
    })).filter(g => g.items.length > 0)

    return (
      <Box flexDirection="column" rowGap={1}>
        {tabs}
        {Input ? (
          <Input
            key="search"
            placeholder={tt('search.placeholder', all.length)}
            value={q}
            autoFocus
            onInput={(v: string) => void update($, query, () => v)}
            onSubmit={(v: string) => {
              const first = filter(all, v)[0]
              if (first) void press(first.name)
            }}
          />
        ) : null}

        <Text dimColor>{tt('hint')}</Text>

        {!q.trim() ? (
          <Box flexDirection="column">
            <Text bold>{tt('favorites')}</Text>
            {favorites(all).map(row('fav'))}
          </Box>
        ) : null}

        {groups.map(g => (
          <Box key={`group:${g.source}`} flexDirection="column">
            <Text bold>{tt(g.title)}</Text>
            {g.items.map(row('cmd'))}
          </Box>
        ))}

        {hits.length === 0 ? <Text dimColor>{tt('commands.none')}</Text> : null}
      </Box>
    )
  })
}
