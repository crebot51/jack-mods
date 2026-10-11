import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ChatGPTModelItem, Provider, TranslateConfig } from '../types'
import {
  API_BASE,
  CALLBACK_PATH,
  KEYCHAIN_ACCOUNT,
  KEYCHAIN_MAX_CHUNKS,
  KEYCHAIN_SERVICE,
  LISTENER,
  OIDC_CONFIG_URL,
  PLAN_SCOPE,
  RESOURCE,
  TOKEN_URL,
  USAGE_URL,
  authorizeUrl,
  b64urlFromBytes,
  bytesFromB64url,
  chunkBlob,
  chunkCount,
  callbackFromOutput,
  credsFromTokens,
  keychainWriteScript,
  parseChatGPTModels,
  parseResponseStream,
  pkce,
  randomToken,
  readCallback,
  utf8,
  verifyIdToken,
} from './chatgpt'
import type { ChatGPTCreds, ChatGPTModel, Jwk, TokenResponse } from './chatgpt'

export const EMPTY: TranslateConfig = {
  enabled: false,
  baseUrl: '',
  apiKey: '',
  model: '',
  provider: 'openai',
  chatgptModel: '',
  chatgptEmail: '',
}

const isOpen = atom({ plugin: 'translate-en', key: 'isOpen' } as const, false)
const config = atom({ plugin: 'translate-en', key: 'config' } as const, EMPTY)
const models = atom({ plugin: 'translate-en', key: 'models' } as const, [] as string[])
const modelQuery = atom({ plugin: 'translate-en', key: 'modelQuery' } as const, '')
const notice = atom({ plugin: 'translate-en', key: 'notice' } as const, '')
const busy = atom({ plugin: 'translate-en', key: 'busy' } as const, false)
const chatgptModels = atom({ plugin: 'translate-en', key: 'chatgptModels' } as const, [] as ChatGPTModelItem[])

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
  'About this user: they are an American who wants to learn Chinese. ' +
  'Reply to them in Simplified Chinese, so they can read more Chinese and keep learning.'

/** 斜杠命令里，参数是给模型看的自由文本、需要翻译的内置命令；其余内置命令的参数是选项或 ID，不翻 */
export const FREE_TEXT_BUILTINS = new Set(['compact'])

/** 这个命令的参数要不要翻：技能、插件、自己的命令、MCP 命令都翻，内置命令只翻名单里的 */
export function shouldTranslateCommand(name: string, source: string | undefined): boolean {
  if (!source || source === 'builtin') return FREE_TEXT_BUILTINS.has(name)
  return true
}

/** 去掉旧版本存的、已经不用的字段（回复语言现在固定为学中文模式） */
export function migrateConfig(saved: Record<string, unknown>): Partial<TranslateConfig> {
  const out = { ...saved }
  delete out.replyInChinese
  delete out.replyMode
  return out as Partial<TranslateConfig>
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
  if (c.provider === 'chatgpt') return !!(c.chatgptEmail && c.chatgptModel)
  return !!(c.baseUrl && c.apiKey && c.model)
}

/** 当前用来翻译的模型 */
export function activeModel(c: TranslateConfig): string {
  return c.provider === 'chatgpt' ? c.chatgptModel : c.model
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
const USER_AGENT = 'claude-translate-en/0.6.0'

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

// ── ChatGPT 订阅：要用到 $ 的部分（网络、钥匙串）只能写在这个文件里 ──

async function postForm($: EngineInterface, url: string, form: Record<string, string>) {
  const res = await $.http.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  })
  let body: TokenResponse = {}
  try {
    body = JSON.parse(res.text) as TokenResponse
  } catch {
    // 不是 JSON
  }
  return { status: res.status, ok: res.ok, body }
}

function tokenError(status: number, body: TokenResponse): Error {
  const why = body.error_description ?? body.error ?? ''
  return new Error(`登录服务返回 HTTP ${status}${why ? `：${why}` : ''}`)
}

async function exchangeCode(
  $: EngineInterface,
  a: { clientId: string; code: string; verifier: string; redirectUri: string },
): Promise<TokenResponse> {
  const r = await postForm($, TOKEN_URL, {
    grant_type: 'authorization_code',
    client_id: a.clientId,
    code: a.code,
    code_verifier: a.verifier,
    redirect_uri: a.redirectUri,
    resource: RESOURCE,
  })
  if (!r.ok || !r.body.access_token) throw tokenError(r.status, r.body)
  return r.body
}

async function fetchJwks($: EngineInterface): Promise<Jwk[]> {
  const conf = await $.http.fetch(OIDC_CONFIG_URL)
  if (!conf.ok) throw new Error(`读取登录服务配置失败：HTTP ${conf.status}`)
  const jwksUri = (JSON.parse(conf.text) as { jwks_uri?: string }).jwks_uri
  if (!jwksUri) throw new Error('登录服务配置里没有 jwks_uri')
  const res = await $.http.fetch(jwksUri)
  if (!res.ok) throw new Error(`读取签名公钥失败：HTTP ${res.status}`)
  return (JSON.parse(res.text) as { keys?: Jwk[] }).keys ?? []
}

// ── 钥匙串 ──

async function keychainGet($: EngineInterface, account: string): Promise<string | undefined> {
  const r = await $.process.run(['security', 'find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w'])
  return r.exitCode === 0 ? r.stdout.trim() : undefined
}

async function readCreds($: EngineInterface): Promise<ChatGPTCreds | undefined> {
  const main = await keychainGet($, KEYCHAIN_ACCOUNT)
  if (!main) return undefined
  const n = chunkCount(main)
  let blob = main
  if (n !== undefined) {
    const parts: string[] = []
    for (let i = 0; i < n; i++) {
      const part = await keychainGet($, `${KEYCHAIN_ACCOUNT}.${i}`)
      if (part === undefined) return undefined
      parts.push(part)
    }
    blob = parts.join('')
  }
  try {
    return JSON.parse(utf8(bytesFromB64url(blob))) as ChatGPTCreds
  } catch {
    return undefined
  }
}

/** 凭证经标准输入交给 security，不出现在命令行参数里；写完读回来核对。报错里不带 security 的输出，免得把凭证显示出来 */
async function writeCreds($: EngineInterface, creds: ChatGPTCreds): Promise<void> {
  const blob = b64urlFromBytes(new TextEncoder().encode(JSON.stringify(creds)))
  const chunks = chunkBlob(blob)
  if (chunks.length > KEYCHAIN_MAX_CHUNKS) throw new Error('凭证太长，钥匙串存不下')
  const r = await $.process.run(['security', '-i'], { stdin: keychainWriteScript(chunks) })
  const back = await readCreds($)
  if (!back || back.refreshToken !== creds.refreshToken || back.accessToken !== creds.accessToken) {
    throw new Error(`写入钥匙串失败（security 退出码 ${r.exitCode}）`)
  }
}

async function deleteCreds($: EngineInterface): Promise<void> {
  await $.process.run(['security', 'delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT])
  for (let i = 0; i < KEYCHAIN_MAX_CHUNKS; i++) {
    const r = await $.process.run(['security', 'delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', `${KEYCHAIN_ACCOUNT}.${i}`])
    if (r.exitCode !== 0) break
  }
}

/** 快过期（2 分钟内）就刷新；新的 refresh token 会替换旧的 */
async function refreshIfNeeded($: EngineInterface, creds: ChatGPTCreds): Promise<ChatGPTCreds> {
  const now = await $.clock.now()
  if (creds.expiresAt - now > 120_000) return creds
  const r = await postForm($, TOKEN_URL, {
    grant_type: 'refresh_token',
    client_id: creds.clientId,
    refresh_token: creds.refreshToken,
    resource: RESOURCE,
  })
  if (!r.ok || !r.body.access_token) {
    if (r.body.error === 'invalid_grant') throw new Error('ChatGPT 登录已失效，请在面板里重新登录')
    throw tokenError(r.status, r.body)
  }
  const next = credsFromTokens(r.body, { ...creds, nowMs: now })
  if (!next.refreshToken) next.refreshToken = creds.refreshToken
  if (!next.scopes.length) next.scopes = creds.scopes
  await writeCreds($, next)
  return next
}

/** 退出登录：先尽量吊销 refresh token，再清本机凭证；返回是否确认吊销 */
async function revoke($: EngineInterface, creds: ChatGPTCreds): Promise<boolean> {
  try {
    const conf = await $.http.fetch(OIDC_CONFIG_URL)
    const url = (JSON.parse(conf.text) as { revocation_endpoint?: string }).revocation_endpoint
    if (!url) return false
    const r = await postForm($, url, { token: creds.refreshToken, token_type_hint: 'refresh_token', client_id: creds.clientId })
    return r.ok
  } catch {
    return false
  }
}

async function listModels($: EngineInterface, accessToken: string): Promise<ChatGPTModel[]> {
  const res = await $.http.fetch(`${API_BASE}/models`, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`获取模型失败：HTTP ${res.status}`)
  return parseChatGPTModels(res.text)
}

async function respond($: EngineInterface, accessToken: string, model: string, instructions: string, text: string): Promise<string> {
  const res = await $.http.fetch(`${API_BASE}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      model,
      instructions,
      input: [{ role: 'user', content: text }],
      store: false,
      stream: true,
    }),
  })
  if (!res.ok) {
    let why = res.text.slice(0, 200)
    try {
      const body = JSON.parse(res.text) as { error?: { message?: string; code?: string } }
      why = body.error?.message ?? body.error?.code ?? why
    } catch {
      // 不是 JSON
    }
    if (res.status === 401) throw new Error('ChatGPT 登录已失效，请在面板里重新登录')
    throw new Error(`ChatGPT 返回 HTTP ${res.status}${why ? `：${why}` : ''}`)
  }
  return parseResponseStream(res.text)
}

/** 钥匙串里的 ChatGPT 凭证，读过一次就留在内存里，免得每条消息都读钥匙串 */
let credsCache: ChatGPTCreds | undefined

async function chatgptToken($: EngineInterface): Promise<string> {
  const creds = credsCache ?? (await readCreds($))
  if (!creds) throw new Error('还没有登录 ChatGPT，请在面板里登录')
  credsCache = await refreshIfNeeded($, creds)
  return credsCache.accessToken
}

/** 把一段文字翻成英文：ChatGPT 订阅走 Responses API，其余走用户自己的 /chat/completions */
export async function translate($: EngineInterface, c: TranslateConfig, text: string): Promise<string> {
  if (c.provider === 'chatgpt') {
    const out = await respond($, await chatgptToken($), c.chatgptModel, SYSTEM_PROMPT, text)
    if (!out) throw new Error('译文是空的')
    return out
  }
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

/** 翻译加超时：超时就放弃；翻译先回来就取消计时（计时会占用钩子的预算） */
async function translateWithTimeout($: EngineInterface, c: TranslateConfig, text: string): Promise<string> {
  const stop = new AbortController()
  const timeout = $.clock.sleep(TRANSLATE_TIMEOUT_MS, { signal: stop.signal }).then(
    () => {
      throw new Error(`翻译超过 ${TRANSLATE_TIMEOUT_MS / 1000} 秒没有返回`)
    },
    // 计时被取消或出错不算超时，只等翻译本身
    () => new Promise<never>(() => {}),
  )
  timeout.catch(() => {})
  return Promise.race([translate($, c, text), timeout]).finally(() => stop.abort())
}

/** 斜杠命令的来源（builtin / plugin / user / mcp），会话里查一次就记住 */
let commandSources: Map<string, string | undefined> | undefined

async function commandSource($: EngineInterface, name: string): Promise<string | undefined> {
  if (!commandSources?.has(name)) {
    const list = await $.command.list()
    commandSources = new Map(list.map(cmd => [cmd.name, cmd.source]))
  }
  return commandSources.get(name)
}

/** 以存下来的配置为准，顺便同步到界面用的 config，避免两边不一致（比如新会话里开关显示错） */
async function loadConfig($: EngineInterface): Promise<TranslateConfig> {
  const saved = await $.store.get('config')
  const current = await read($, config)
  if (!saved || typeof saved !== 'object') return current
  const loaded = { ...EMPTY, ...migrateConfig(saved as Record<string, unknown>) }
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
    await update($, notice, () => (c.provider === 'chatgpt' ? '先登录 ChatGPT 并选好模型' : 'Base URL、Key、模型都要填好'))
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

async function hostId($: EngineInterface): Promise<string> {
  const saved = await $.store.get('hostId')
  if (typeof saved === 'string' && saved) return saved
  const id = `urn:uuid:${crypto.randomUUID()}`
  await $.store.set('hostId', id)
  return id
}

async function refreshChatGPTModels($: EngineInterface) {
  const list = await listModels($, await chatgptToken($))
  await update($, chatgptModels, () => list)
  await $.store.set('chatgptModels', list)
  const c = await loadConfig($)
  if (list.length && !list.some(m => m.slug === c.chatgptModel)) {
    // 默认挑一个轻量模型，翻译用不着最大的
    const pick = list.find(m => /mini|luna|nano/i.test(m.slug)) ?? list[0]!
    await saveConfig($, { chatgptModel: pick.slug })
  }
  return list
}

/** 用 ChatGPT 账号登录：本机临时监听回调，浏览器里授权，换令牌、校验身份，凭证存进钥匙串 */
async function signInChatGPT($: EngineInterface) {
  await update($, busy, () => true)
  try {
    const host = await hostId($)
    const saved = await $.store.get('chatgptClientId')
    const savedClientId = typeof saved === 'string' && saved ? saved : undefined
    const old = savedClientId ? await readCreds($).catch(() => undefined) : undefined
    const state = randomToken()
    const nonce = randomToken()
    const { verifier, challenge } = await pkce()

    // 先用 1455 端口，被占用就换一个随机端口
    let port = 1455
    let listening: Promise<{ exitCode: number; stdout: string }> | undefined
    for (let attempt = 0; attempt < 4 && !listening; attempt++) {
      const run = $.process.run(['perl', '-e', LISTENER, String(port), '300'], { timeoutMs: 310_000 })
      const early = await Promise.race([run.then(r => r), $.clock.sleep(400).then(() => undefined)])
      if (early && /LISTEN_FAILED/.test(early.stdout)) {
        port = 20000 + Math.floor(Math.random() * 40000)
        continue
      }
      listening = early ? Promise.resolve(early) : run
    }
    if (!listening) throw new Error('本机找不到可用端口来接收登录回调')
    const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`
    const url = authorizeUrl({
      clientId: savedClientId,
      hostId: host,
      redirectUri,
      state,
      nonce,
      challenge,
      idTokenHint: old?.idToken,
      loginHint: old?.email,
    })
    await $.process.run(['open', url])
    await update($, notice, () => '已在浏览器打开 ChatGPT 登录页，登录并授权后会自动回到这里（5 分钟内有效）')

    const out = await listening
    const path = callbackFromOutput(out.stdout)
    if (!path) throw new Error(/TIMEOUT/.test(out.stdout) ? '5 分钟内没有完成登录，已取消' : '没有收到登录回调')
    const cb = readCallback(path, state)
    if (!cb.ok) throw new Error(cb.reason)
    if (savedClientId && cb.clientId && cb.clientId !== savedClientId) throw new Error('回调里的应用 ID 和之前注册的不一致，已放弃')
    const clientId = savedClientId ?? cb.clientId
    if (!clientId) throw new Error('注册没有完成：回调里没有应用 ID')

    const tokens = await exchangeCode($, { clientId, code: cb.code, verifier, redirectUri })
    if (!tokens.id_token) throw new Error('登录服务没有返回 ID token')
    const now = await $.clock.now()
    const who = await verifyIdToken(tokens.id_token, await fetchJwks($), { clientId, nonce, nowMs: now })
    const creds = credsFromTokens(tokens, { clientId, sub: who.sub, email: who.email, nowMs: now })
    if (!creds.scopes.includes(PLAN_SCOPE)) {
      throw new Error('登录成功了，但没有允许使用 ChatGPT 订阅额度。可以重新登录并勾选，或在 ChatGPT 设置里打开')
    }
    await writeCreds($, creds)
    credsCache = creds
    await $.store.set('chatgptClientId', clientId)
    await saveConfig($, { chatgptEmail: who.email || '已登录', provider: 'chatgpt' })
    const list = await refreshChatGPTModels($)
    await update($, notice, () => `✓ 已登录 ${who.email}，可用模型 ${list.length} 个`)
  } catch (err) {
    await update($, notice, () => `✗ ChatGPT 登录失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    await update($, busy, () => false)
  }
}

async function signOutChatGPT($: EngineInterface) {
  const creds = credsCache ?? (await readCreds($).catch(() => undefined))
  const revoked = creds ? await revoke($, creds) : true
  await deleteCreds($).catch(() => {})
  credsCache = undefined
  await saveConfig($, { chatgptEmail: '' })
  await update($, notice, () =>
    revoked ? '已退出 ChatGPT 登录' : '已清除本机凭证，但没能确认远程吊销；可以在 ChatGPT 设置里断开这个应用',
  )
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
    const savedChatGPT = await $.store.get('chatgptModels')
    if (Array.isArray(savedChatGPT)) {
      await update($, chatgptModels, () =>
        savedChatGPT.filter((m): m is ChatGPTModelItem => !!m && typeof m === 'object' && typeof (m as ChatGPTModelItem).slug === 'string'),
      )
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
      const text = await translateWithTimeout($, c, e.text)
      // 只换成译文，不附原文，也不说明翻译过：模型看不出原本用的什么语言
      return await next({ ...e, text })
    } catch (err) {
      $.ui.toast(`翻译失败，已发送原文：${err instanceof Error ? err.message : String(err)}`)
      return next(e)
    } finally {
      $.ui.status(undefined)
    }
  }).catch(($, e, next) => next(e))

  // 斜杠命令的参数里有中文也先翻成英文；内置命令只翻接自由文本的，参数是选项或 ID 的不动
  on('command.run', async ($, e, next) => {
    const c = await loadConfig($)
    if (!c.enabled || !isReady(c) || !USER_ORIGINS.has(e.origin.kind) || !needsTranslation(e.args)) return next(e)
    if (!shouldTranslateCommand(e.command, await commandSource($, e.command))) return next(e)
    $.ui.status('🌐 正在翻译命令参数…')
    $.ui.toast('🌐 正在翻译命令参数…')
    let args: string
    try {
      args = await translateWithTimeout($, c, e.args)
    } catch (err) {
      $.ui.toast(`翻译失败，按原参数执行：${err instanceof Error ? err.message : String(err)}`)
      return next(e)
    } finally {
      $.ui.status(undefined)
    }
    return next({ ...e, args })
  }).catch(($, e, next) => next(e))

  // 系统提示词末尾加一节：用户在学中文、请用中文回复；整个会话只有这一份
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const c = await read($, config)
    if (!c.enabled || !isReady(c) || result.sections.some(s => s.id === LEARNER_SECTION_ID)) return result
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
    const Link = 'Link' in els ? els.Link : undefined
    const c = await read($, config)
    const gptList = await read($, chatgptModels)
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
              if (nextCfg.enabled && !isReady(nextCfg)) await update($, notice, () => nextCfg.provider === 'chatgpt' ? '已开启，但还没登录 ChatGPT 或没选模型，暂时不会翻译' : '已开启，但 Base URL、Key、模型还没填全，暂时不会翻译')
              else await update($, notice, () => '')
            }}
          />
          <Text dimColor>{ready ? `用 ${activeModel(c)} 翻译` : '未配置完成'}</Text>
        </Box>

        <Box flexDirection="row" columnGap={1} alignItems="center">
          <Text bold>接口</Text>
          {(['openai', 'chatgpt'] as Provider[]).map(p => (
            <Button
              key={`provider:${p}`}
              label={`${c.provider === p ? '●' : '○'} ${p === 'openai' ? 'OpenAI 兼容接口' : 'ChatGPT 订阅'}`}
              variant={c.provider === p ? 'primary' : 'secondary'}
              onPress={async () => {
                await saveConfig($, { provider: p })
                await update($, notice, () => '')
              }}
            />
          ))}
        </Box>


        {c.provider === 'chatgpt' ? (
          <Box flexDirection="column" rowGap={1}>
            {c.chatgptEmail ? (
              <Box flexDirection="row" columnGap={1} alignItems="center">
                <Text bold>账号</Text>
                <Text>{c.chatgptEmail}</Text>
                <Button key="chatgpt-logout" label="退出登录" dimColor onPress={() => signOutChatGPT($)} />
                {Link ? <Link key="chatgpt-usage" href={USAGE_URL} label="管理用量" /> : null}
              </Box>
            ) : (
              <Box flexDirection="column">
                <Button
                  key="chatgpt-login"
                  label={isBusy ? '等待浏览器里完成登录…' : 'Continue with ChatGPT'}
                  variant="primary"
                  onPress={() => (isBusy ? undefined : signInChatGPT($))}
                />
                <Text dimColor>用你的 ChatGPT 订阅（Plus / Pro）翻译，不需要 API Key。会打开浏览器登录授权；凭证加密存进 macOS 钥匙串。</Text>
              </Box>
            )}
            {c.chatgptEmail ? (
              <Box flexDirection="column">
                <Box flexDirection="row" columnGap={1} alignItems="center">
                  <Text bold>模型</Text>
                  <Text>{gptList.find(m => m.slug === c.chatgptModel)?.name ?? (c.chatgptModel || '未选择')}</Text>
                  <Button
                    key="chatgpt-models"
                    label="刷新模型列表"
                    dimColor
                    onPress={async () => {
                      try {
                        const list = await refreshChatGPTModels($)
                        await update($, notice, () => `可用模型 ${list.length} 个`)
                      } catch (err) {
                        await update($, notice, () => `获取模型失败：${err instanceof Error ? err.message : String(err)}`)
                      }
                    }}
                  />
                  <Button key="test" label="测试" dimColor onPress={() => testTranslate($)} />
                </Box>
                <Box flexDirection="column">
                  {gptList.map(m => (
                    <Button
                      key={`gm:${m.slug}`}
                      label={m.slug === c.chatgptModel ? `✓ ${m.name}` : `   ${m.name}`}
                      plain
                      dimColor={m.slug !== c.chatgptModel}
                      onPress={async () => {
                        await saveConfig($, { chatgptModel: m.slug })
                        await update($, notice, () => `已选择模型 ${m.name}`)
                      }}
                    />
                  ))}
                </Box>
              </Box>
            ) : null}
          </Box>
        ) : (
          <Box flexDirection="column" rowGap={1}>
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

          </Box>
        )}

        {msg ? <Text dimColor>{msg}</Text> : null}
        <Text dimColor>开启后，你发的中文消息和斜杠命令参数会先翻成英文再发给 Claude，并告诉 Claude 你是想学中文的美国人、请用中文回复；不会告诉它消息翻译过。纯英文不翻；翻译失败会照原文发送。</Text>
      </Box>
    )
  })
}
