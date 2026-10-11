import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TranslateConfig } from '../types'

export const EMPTY: TranslateConfig = { enabled: false, baseUrl: '', apiKey: '', model: '', replyInChinese: true }

const isOpen = atom({ plugin: 'translate-en', key: 'isOpen' } as const, false)
const config = atom({ plugin: 'translate-en', key: 'config' } as const, EMPTY)
const models = atom({ plugin: 'translate-en', key: 'models' } as const, [] as string[])
const modelQuery = atom({ plugin: 'translate-en', key: 'modelQuery' } as const, '')
const notice = atom({ plugin: 'translate-en', key: 'notice' } as const, '')
const busy = atom({ plugin: 'translate-en', key: 'busy' } as const, false)

/** 设置面板的 id */
export const PANE = 'translate-en'

/** 只翻这些来源的消息：用户自己在输入框、手机端、桌面端发的；后台通知、其他会话、插件发的不动 */
const USER_ORIGINS = new Set(['composer', 'bridge', 'sdk', 'unclassified'])

const SYSTEM_PROMPT =
  'You are a translation engine. Translate the user message into natural, fluent English. ' +
  'Keep code, code blocks, commands, file paths, URLs, identifiers, numbers and markdown formatting exactly as they are. ' +
  'If parts are already English, keep them unchanged. ' +
  'Output only the translated text, with no explanations, notes or quotes.'

/** 系统提示词里追加的一节：整个会话只有一份，开着「用中文回复」时才加 */
export const LEARNER_SECTION_ID = 'translate-en:learner'
export const LEARNER_NOTE =
  'About this user: they are an American who has recently been learning Chinese, so they can type in Chinese. ' +
  'They type their messages in Chinese, but are afraid Claude might not understand their Chinese, ' +
  'so each of their Chinese messages is machine-translated into English before it reaches you; ' +
  'the original Chinese follows the message as extra context. ' +
  'Reply to them in Simplified Chinese, so they can read more Chinese replies and keep learning Chinese.'

/** 每条翻译过的消息后面只附原文 */
export function originalNote(original: string): string {
  return `Original Chinese message (before machine translation):\n${original}`
}

/** 翻译等多久就放弃、照原文发送；钩子预算 10 秒，留一点余量 */
export const TRANSLATE_TIMEOUT_MS = 9000

/** 去掉末尾的斜杠和用户误填的 /chat/completions、/models */
export function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/(chat\/completions|models)$/, '')
}

/** 需要翻译吗：空的、斜杠命令、本来就全是 ASCII 的不翻 */
export function needsTranslation(text: string): boolean {
  const t = text.trim()
  if (!t || t.startsWith('/')) return false
  return /[^\x00-\x7f]/.test(t) && /[\p{L}]/u.test(t.replace(/[\x00-\x7f]/g, ''))
}

/** Key 只露前 3 位和后 4 位 */
export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 10) return '•'.repeat(key.length)
  return `${key.slice(0, 3)}…${key.slice(-4)}`
}

export function isReady(c: TranslateConfig): boolean {
  return !!(c.baseUrl && c.apiKey && c.model)
}

/** 从 /models 的回复里取模型 id */
export function parseModels(text: string): string[] {
  try {
    const body = JSON.parse(text) as { data?: { id?: unknown }[]; models?: { id?: unknown; name?: unknown }[] }
    const list = body.data ?? body.models ?? []
    const ids = list.map(m => (typeof m.id === 'string' ? m.id : 'name' in m && typeof m.name === 'string' ? m.name : ''))
    return [...new Set(ids.filter(Boolean))].sort()
  } catch {
    return []
  }
}

/** 从 /chat/completions 的回复里取译文；去掉推理模型可能带的 <think> 段 */
export function parseCompletion(text: string): string {
  const body = JSON.parse(text) as { choices?: { message?: { content?: unknown } }[] }
  const content = body.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('回复里没有译文')
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}

/** 接口报错时取一句能看懂的原因 */
export function errorReason(status: number, text: string): string {
  try {
    const body = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown }
    const msg = typeof body.error === 'string' ? body.error : body.error?.message ?? body.message
    if (typeof msg === 'string' && msg) return `HTTP ${status}：${msg.slice(0, 200)}`
  } catch {
    // 不是 JSON，用原文
  }
  return `HTTP ${status}${text ? `：${text.slice(0, 200)}` : ''}`
}

/** 请求带上自己的 User-Agent 和固定的会话 id：opencode Go 等网关要求有 x-opencode-session，其他接口会忽略 */
const USER_AGENT = 'claude-translate-en/0.3.1'

async function headers($: EngineInterface, c: TranslateConfig): Promise<Record<string, string>> {
  let session = 'translate-en'
  try {
    session = `translate-en-${await $.session.id()}`
  } catch {
    // 拿不到会话 id 就用固定值
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${c.apiKey}`,
    'User-Agent': USER_AGENT,
    'x-opencode-session': session,
  }
}

/** 调用户自己的接口把一段文字翻成英文 */
export async function translate($: EngineInterface, c: TranslateConfig, text: string): Promise<string> {
  const res = await $.http.fetch(`${normalizeBase(c.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: await headers($, c),
    body: JSON.stringify({
      model: c.model,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
    }),
  })
  if (!res.ok) throw new Error(errorReason(res.status, res.text))
  const out = parseCompletion(res.text)
  if (!out) throw new Error('译文是空的')
  return out
}

/** 以存下来的配置为准，顺便同步到界面用的 config，避免两边不一致（比如新会话里开关显示错） */
async function loadConfig($: EngineInterface): Promise<TranslateConfig> {
  const saved = await $.store.get('config')
  const current = await read($, config)
  if (!saved || typeof saved !== 'object') return current
  const loaded = { ...EMPTY, ...(saved as Partial<TranslateConfig>) }
  if (JSON.stringify(loaded) !== JSON.stringify(current)) await update($, config, () => loaded)
  return loaded
}

async function saveConfig($: EngineInterface, patch: Partial<TranslateConfig>) {
  const next = { ...(await loadConfig($)), ...patch }
  await update($, config, () => next)
  await $.store.set('config', next)
  return next
}

/** 输入框里还没点「保存」的内容；点获取模型、测试、开关时先存下来 */
const drafts: { baseUrl?: string; apiKey?: string } = {}

async function commitDrafts($: EngineInterface) {
  const patch: Partial<TranslateConfig> = {}
  if (drafts.baseUrl !== undefined && drafts.baseUrl.trim()) patch.baseUrl = normalizeBase(drafts.baseUrl)
  if (drafts.apiKey !== undefined && drafts.apiKey.trim()) patch.apiKey = drafts.apiKey.trim()
  drafts.baseUrl = undefined
  drafts.apiKey = undefined
  return Object.keys(patch).length ? saveConfig($, patch) : read($, config)
}

async function fetchModels($: EngineInterface) {
  const c = await commitDrafts($)
  if (!c.baseUrl || !c.apiKey) {
    await update($, notice, () => '先填 Base URL 和 Key')
    return
  }
  await update($, busy, () => true)
  await update($, notice, () => '正在获取模型列表…')
  try {
    const res = await $.http.fetch(`${normalizeBase(c.baseUrl)}/models`, { headers: await headers($, c) })
    if (!res.ok) throw new Error(errorReason(res.status, res.text))
    const list = parseModels(res.text)
    await update($, models, () => list)
    await $.store.set('models', list)
    await update($, notice, () => (list.length ? `获取到 ${list.length} 个模型` : '接口没有返回模型，可以在下面手动填写'))
  } catch (err) {
    await update($, notice, () => `获取模型失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    await update($, busy, () => false)
  }
}

async function testTranslate($: EngineInterface) {
  const c = await commitDrafts($)
  if (!isReady(c)) {
    await update($, notice, () => 'Base URL、Key、模型都要填好')
    return
  }
  await update($, busy, () => true)
  await update($, notice, () => '正在测试…')
  try {
    const out = await translate($, c, '你好，帮我看看这个函数为什么报错。')
    await update($, notice, () => `✓ 测试成功：${out}`)
  } catch (err) {
    await update($, notice, () => `✗ 测试失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    await update($, busy, () => false)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await update($, isOpen, () => false)
    await update($, busy, () => false)
    await update($, notice, () => '')
    await loadConfig($)
    const savedModels = await $.store.get('models')
    if (Array.isArray(savedModels)) {
      await update($, models, () => savedModels.filter((m): m is string => typeof m === 'string'))
    }
    return result
  })

  // 发送前翻译。翻译失败就照原文发出，并提示原因
  on('prompt.submit', async ($, e, next) => {
    const c = await loadConfig($)
    if (!c.enabled || !isReady(c) || !USER_ORIGINS.has(e.origin.kind) || !needsTranslation(e.text)) {
      return next(e)
    }
    // 桌面端没有状态行，同时弹一条提示，免得以为卡住了
    $.ui.status('🌐 正在翻译成英文…')
    $.ui.toast('🌐 正在翻译成英文…')
    try {
      // 超时就放弃、照原文发送；翻译先回来就取消计时，计时会占用钩子的预算
      const stop = new AbortController()
      const timeout = $.clock.sleep(TRANSLATE_TIMEOUT_MS, { signal: stop.signal }).then(
        () => {
          throw new Error(`翻译超过 ${TRANSLATE_TIMEOUT_MS / 1000} 秒没有返回`)
        },
        // 计时被取消或出错不算超时，只等翻译本身
        () => new Promise<never>(() => {}),
      )
      timeout.catch(() => {})
      const text = await Promise.race([translate($, c, e.text), timeout]).finally(() => stop.abort())
      const context = c.replyInChinese ? [...(e.context ?? []), originalNote(e.text)] : e.context
      return await next({ ...e, text, ...(context ? { context } : {}) })
    } catch (err) {
      $.ui.toast(`翻译失败，已发送原文：${err instanceof Error ? err.message : String(err)}`)
      return next(e)
    } finally {
      $.ui.status(undefined)
    }
  }).catch(($, e, next) => next(e))

  // 开着「用中文回复」时，在系统提示词末尾加一节说明，整个会话只有这一份
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const c = await read($, config)
    if (!c.enabled || !isReady(c) || !c.replyInChinese) return result
    if (result.sections.some(s => s.id === LEARNER_SECTION_ID)) return result
    return { sections: [...result.sections, { id: LEARNER_SECTION_ID, text: LEARNER_NOTE, scope: 'session' as const }] }
  }).catch(($, e, next) => next(e))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const result = await next(e)
    await update($, isOpen, () => false)
    $.ui.invalidate('ui.render')
    return result
  }).catch(($, e, next) => next(e))

  // 模型名旁边的常驻按钮：只有一个地球图标，开着时正常颜色，关着或没配置时变灰
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const engine = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    const c = await read($, config)
    const active = c.enabled && isReady(c)

    return (
      <Box>
        {engine}
        <Button
          key="translate-toggle"
          label="🌐"
          plain
          dimColor={!active}
          onPress={async () => {
            if ((await $.ui.panes()).some(p => p.id === PANE)) {
              await $.ui.close({ id: PANE })
              await update($, isOpen, () => false)
              return
            }
            await loadConfig($)
            await update($, notice, () => '')
            await update($, modelQuery, () => '')
            const opened = await $.ui.open({ id: PANE, title: '翻译成英文', focus: true, closeOnEscape: true, rows: 14 })
            if (opened.isPlaced) await update($, isOpen, () => true)
            else $.ui.toast(`设置面板没能打开：${opened.reason}`)
          }}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    const Input = 'Input' in els ? els.Input : undefined
    const c = await read($, config)
    const list = await read($, models)
    const q = await read($, modelQuery)
    const msg = await read($, notice)
    const isBusy = await read($, busy)
    const ready = isReady(c)

    const shown = list.filter(m => m.toLowerCase().includes(q.trim().toLowerCase()))

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" columnGap={1} alignItems="center">
          <Text bold>状态</Text>
          <Button
            key="enable"
            label={c.enabled ? '● 已开启' : '○ 已关闭'}
            variant={c.enabled ? 'primary' : 'secondary'}
            onPress={async () => {
              await commitDrafts($)
              const nextCfg = await saveConfig($, { enabled: !c.enabled })
              if (nextCfg.enabled && !isReady(nextCfg)) await update($, notice, () => '已开启，但 Base URL、Key、模型还没填全，暂时不会翻译')
              else await update($, notice, () => '')
            }}
          />
          <Text dimColor>{ready ? `用 ${c.model} 翻译` : '未配置完成'}</Text>
        </Box>

        <Box flexDirection="row" columnGap={1} alignItems="center">
          <Text bold>回复</Text>
          <Button
            key="reply-zh"
            label={c.replyInChinese ? '● 用中文回复' : '○ 用中文回复'}
            variant={c.replyInChinese ? 'primary' : 'secondary'}
            onPress={() => saveConfig($, { replyInChinese: !c.replyInChinese })}
          />
          <Text dimColor>{c.replyInChinese ? '在系统提示词里说明你在学中文、请用中文回复；每条消息附上原文' : 'Claude 只看到英文，通常会用英文回复'}</Text>
        </Box>

        {Input ? (
          <Box flexDirection="column">
            <Text bold>Base URL</Text>
            <Input
              key="base"
              value={c.baseUrl}
              onInput={(v: string) => {
                drafts.baseUrl = v
              }}
              placeholder="https://api.example.com/v1"
              submitLabel="保存"
              onSubmit={(v: string) => {
                drafts.baseUrl = undefined
                void saveConfig($, { baseUrl: normalizeBase(v) }).then(() => update($, notice, () => '已保存 Base URL'))
              }}
            />
          </Box>
        ) : (
          <Text dimColor>Base URL：{c.baseUrl || '未设置'}</Text>
        )}

        {Input ? (
          <Box flexDirection="column">
            <Text bold>API Key {c.apiKey ? <Text dimColor>（已保存 {maskKey(c.apiKey)}，重新输入可替换）</Text> : null}</Text>
            <Input
              key="key"
              value=""
              onInput={(v: string) => {
                drafts.apiKey = v
              }}
              placeholder={c.apiKey ? '输入新 Key 替换' : 'sk-...'}
              submitLabel="保存"
              onSubmit={(v: string) => {
                const k = v.trim()
                drafts.apiKey = undefined
                if (!k) return
                void saveConfig($, { apiKey: k }).then(() => update($, notice, () => '已保存 Key'))
              }}
            />
          </Box>
        ) : (
          <Text dimColor>API Key：{c.apiKey ? maskKey(c.apiKey) : '未设置'}</Text>
        )}

        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={1} alignItems="center">
            <Text bold>模型</Text>
            <Text>{c.model || '未选择'}</Text>
            <Button key="fetch-models" label={isBusy ? '…' : '获取模型列表'} dimColor onPress={() => fetchModels($)} />
            <Button key="test" label="测试" dimColor onPress={() => testTranslate($)} />
          </Box>
          {Input ? (
            <Input
              key="model"
              value={q}
              placeholder={list.length ? `筛选 ${list.length} 个模型，回车直接用输入的名字` : '手动输入模型名，回车保存'}
              submitLabel="使用"
              onInput={(v: string) => void update($, modelQuery, () => v)}
              onSubmit={(v: string) => {
                const m = v.trim()
                if (!m) return
                void saveConfig($, { model: m }).then(() => update($, notice, () => `已选择模型 ${m}`))
              }}
            />
          ) : null}
          {shown.length > 0 ? (
            <Box flexDirection="column">
              {shown.map(m => (
                <Button
                  key={`m:${m}`}
                  label={m === c.model ? `✓ ${m}` : `   ${m}`}
                  plain
                  dimColor={m !== c.model}
                  onPress={async () => {
                    await saveConfig($, { model: m })
                    await update($, notice, () => `已选择模型 ${m}`)
                  }}
                />
              ))}
            </Box>
          ) : null}
        </Box>

        {msg ? <Text dimColor>{msg}</Text> : null}
        <Text dimColor>开启后，你发出的含中文等非英文内容的消息会先翻成英文再发给 Claude；斜杠命令和纯英文不翻。翻译失败会照原文发送。</Text>
      </Box>
    )
  })
}
