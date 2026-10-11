// 用 ChatGPT 订阅登录（Sign in with ChatGPT 的 ChatGPT plan usage），按 OpenAI 公开协议文档实现：
// https://developers.openai.com/siwc/token-sharing-open-source

export const ISSUER = 'https://auth.openai.com'
export const AUTHORIZE_URL = 'https://auth.openai.com/api/accounts/authorize'
export const TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token'
export const OIDC_CONFIG_URL = 'https://auth.openai.com/.well-known/openid-configuration'
export const RESOURCE = 'https://api.openai.com/v1'
export const API_BASE = 'https://api.openai.com/v1'
export const USAGE_URL = 'https://chatgpt.com/settings/usage'
export const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
export const PLAN_SCOPE = 'chatgpt.tokens.use.direct'
export const AGENT_NAME = 'Claude Translate EN'
export const CALLBACK_PATH = '/auth/callback'

/** 钥匙串里的条目：凭证只存在这里，不进插件存储 */
export const KEYCHAIN_SERVICE = 'claude-translate-en'
export const KEYCHAIN_ACCOUNT = 'chatgpt'

/** security -i 每行最多约 4096 个字符，凭证要拆成几段分别存 */
export const KEYCHAIN_CHUNK = 3500
/** 最多拆这么多段；清理时也按这个数清 */
export const KEYCHAIN_MAX_CHUNKS = 12

/** 拆成几段，每段一个钥匙串条目（账号名 chatgpt.0、chatgpt.1…），主条目只记段数 */
export function chunkBlob(blob: string, size = KEYCHAIN_CHUNK): string[] {
  const out: string[] = []
  for (let i = 0; i < blob.length; i += size) out.push(blob.slice(i, i + size))
  return out.length ? out : ['']
}

/** 交给 security -i 的写入脚本：先写各段，最后写主条目；值都是 base64url，不含空格和引号 */
export function keychainWriteScript(chunks: readonly string[]): string {
  const label = '"Claude Translate EN (ChatGPT)"'
  const lines = chunks.map((c, i) => `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${KEYCHAIN_ACCOUNT}.${i} -l ${label} -w ${c}`)
  lines.push(`add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${KEYCHAIN_ACCOUNT} -l ${label} -w chunks:${chunks.length}`)
  return lines.join('\n') + '\n'
}

/** 主条目里记的段数；不是这个格式就当作旧版本整段存的 */
export function chunkCount(main: string): number | undefined {
  const m = main.match(/^chunks:(\d+)$/)
  return m ? Number(m[1]) : undefined
}

/** 存进钥匙串的凭证 */
export type ChatGPTCreds = {
  clientId: string
  sub: string
  email: string
  idToken: string
  accessToken: string
  refreshToken: string
  /** 毫秒时间戳 */
  expiresAt: number
  scopes: string[]
}

export type ChatGPTModel = { slug: string; name: string }

// ── 编码 ──

export function b64urlFromBytes(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function bytesFromB64url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function utf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

export function randomToken(bytes = 32): string {
  return b64urlFromBytes(crypto.getRandomValues(new Uint8Array(bytes)))
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data))
}

/** PKCE：随机 verifier 和它的 S256 challenge */
export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(48)
  const challenge = b64urlFromBytes(await sha256(new TextEncoder().encode(verifier)))
  return { verifier, challenge }
}

// ── 授权地址和回调 ──

export type AuthorizeArgs = {
  clientId?: string
  hostId: string
  redirectUri: string
  state: string
  nonce: string
  challenge: string
  idTokenHint?: string
  loginHint?: string
}

/** 第一次登录用 dynamic_agent_client 注册；之后用注册时拿到的 client_id */
export function authorizeUrl(a: AuthorizeArgs): string {
  const p = new URLSearchParams()
  const isNew = !a.clientId
  p.set('client_id', a.clientId ?? 'dynamic_agent_client')
  if (isNew) p.set('agent_name_hint', AGENT_NAME)
  p.set('ext_agent_host_id', a.hostId)
  if (!isNew && a.idTokenHint) p.set('id_token_hint', a.idTokenHint)
  if (!isNew && a.loginHint) p.set('login_hint', a.loginHint)
  p.set('response_type', 'code')
  p.set('redirect_uri', a.redirectUri)
  p.set('scope', SCOPES)
  p.set('resource', RESOURCE)
  p.set('state', a.state)
  p.set('nonce', a.nonce)
  p.set('code_challenge_method', 'S256')
  p.set('code_challenge', a.challenge)
  return `${AUTHORIZE_URL}?${p.toString()}`
}

export type CallbackResult =
  | { ok: true; code: string; clientId?: string }
  | { ok: false; reason: string }

/** 检查回调：state 要对上；用户拒绝、缺 code 都算失败 */
export function readCallback(pathAndQuery: string, state: string): CallbackResult {
  const q = pathAndQuery.includes('?') ? pathAndQuery.slice(pathAndQuery.indexOf('?') + 1) : ''
  const p = new URLSearchParams(q)
  if (p.get('state') !== state) return { ok: false, reason: '回调的 state 对不上，已放弃这次登录' }
  const error = p.get('error')
  if (error === 'access_denied') return { ok: false, reason: '你在浏览器里取消了授权' }
  if (error) return { ok: false, reason: `授权失败：${error}` }
  const code = p.get('code')
  if (!code) return { ok: false, reason: '回调里没有授权码' }
  return { ok: true, code, clientId: p.get('client_id') ?? undefined }
}

// ── 接收回调：插件不能监听端口，借系统自带的 perl 临时监听 127.0.0.1，只接一次回调 ──

export const LISTENER = String.raw`
use strict; use IO::Socket::INET;
my $port = shift;
my $s = IO::Socket::INET->new(LocalAddr => '127.0.0.1', LocalPort => $port, Listen => 5, ReuseAddr => 1)
  or do { print "LISTEN_FAILED\n"; exit 2 };
$| = 1; print "READY\n";
$SIG{ALRM} = sub { print "TIMEOUT\n"; exit 3 }; alarm(shift || 300);
while (my $c = $s->accept) {
  $c->autoflush(1);
  my $line = <$c>; next unless defined $line;
  while (my $h = <$c>) { last if $h =~ /^\r?\n$/ }
  if ($line =~ m{^GET (/auth/callback\?\S*) HTTP}) {
    my $body = "<!doctype html><meta charset=utf-8><title>Claude Translate EN</title><body style='font-family:-apple-system,sans-serif;padding:48px'><h2>\xe5\xb7\xb2\xe6\x94\xb6\xe5\x88\xb0\xe6\x8e\x88\xe6\x9d\x83</h2><p>\xe5\x8f\xaf\xe4\xbb\xa5\xe5\x85\xb3\xe9\x97\xad\xe8\xbf\x99\xe4\xb8\xaa\xe9\xa1\xb5\xe9\x9d\xa2\xef\xbc\x8c\xe5\x9b\x9e\xe5\x88\xb0 Claude\xe3\x80\x82</p>";
    print $c "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: " . length($body) . "\r\nConnection: close\r\n\r\n$body";
    close $c; print "CALLBACK $1\n"; exit 0;
  }
  print $c "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"; close $c;
}
`

/** 从监听脚本的输出里取回调地址 */
export function callbackFromOutput(stdout: string): string | undefined {
  return stdout.match(/^CALLBACK (\S+)$/m)?.[1]
}

// ── 令牌 ──

export type TokenResponse = {
  access_token?: string
  refresh_token?: string
  id_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

// ── ID token 校验：签名（RS256，对照 OpenAI 公布的 JWKS）、issuer、audience、过期时间、nonce ──

export type Jwk = { kid?: string; kty?: string; n?: string; e?: string; alg?: string }

function bigFromBytes(bytes: Uint8Array): bigint {
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  return n
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n
  base %= mod
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod
    base = (base * base) % mod
    exp >>= 1n
  }
  return result
}

/** SHA-256 的 DigestInfo 前缀（PKCS#1 v1.5） */
const SHA256_PREFIX = [0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20]

/** RS256 验签：s^e mod n 解出来必须正好是 00 01 FF..FF 00 DigestInfo || hash */
export async function verifyRs256(signingInput: string, signature: Uint8Array, jwk: Jwk): Promise<boolean> {
  if (!jwk.n || !jwk.e) return false
  const nBytes = bytesFromB64url(jwk.n)
  const n = bigFromBytes(nBytes)
  const e = bigFromBytes(bytesFromB64url(jwk.e))
  const k = nBytes[0] === 0 ? nBytes.length - 1 : nBytes.length
  if (signature.length !== k) return false
  let m = modPow(bigFromBytes(signature), e, n)
  const em = new Uint8Array(k)
  for (let i = k - 1; i >= 0; i--) {
    em[i] = Number(m & 0xffn)
    m >>= 8n
  }
  const hash = await sha256(new TextEncoder().encode(signingInput))
  const t = [...SHA256_PREFIX, ...hash]
  const padLen = k - 3 - t.length
  if (padLen < 8) return false
  if (em[0] !== 0x00 || em[1] !== 0x01) return false
  for (let i = 2; i < 2 + padLen; i++) if (em[i] !== 0xff) return false
  if (em[2 + padLen] !== 0x00) return false
  for (let i = 0; i < t.length; i++) if (em[3 + padLen + i] !== t[i]) return false
  return true
}

type IdClaims = { iss?: string; aud?: string | string[]; exp?: number; nonce?: string; sub?: string; email?: string }

export function decodeJwt(token: string): { header: { alg?: string; kid?: string }; claims: IdClaims; signingInput: string; signature: Uint8Array } {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('ID token 格式不对')
  const [h, p, s] = parts as [string, string, string]
  return {
    header: JSON.parse(utf8(bytesFromB64url(h))) as { alg?: string; kid?: string },
    claims: JSON.parse(utf8(bytesFromB64url(p))) as IdClaims,
    signingInput: `${h}.${p}`,
    signature: bytesFromB64url(s),
  }
}

/** 校验 ID token，返回已验证的账号身份 */
export async function verifyIdToken(
  idToken: string,
  keys: readonly Jwk[],
  expect: { clientId: string; nonce: string; nowMs: number },
): Promise<{ sub: string; email: string }> {
  const { header, claims, signingInput, signature } = decodeJwt(idToken)
  if (header.alg !== 'RS256') throw new Error(`ID token 的签名算法 ${header.alg ?? '?'} 不支持`)
  const key = keys.find(k => k.kid === header.kid && k.kty === 'RSA')
  if (!key) throw new Error('找不到 ID token 对应的签名公钥')
  if (!(await verifyRs256(signingInput, signature, key))) throw new Error('ID token 签名校验失败')
  if (claims.iss !== ISSUER) throw new Error('ID token 的签发方不对')
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!aud.includes(expect.clientId)) throw new Error('ID token 的受众不是本应用')
  if (!claims.exp || claims.exp * 1000 < expect.nowMs - 60_000) throw new Error('ID token 已过期')
  if (claims.nonce !== expect.nonce) throw new Error('ID token 的 nonce 对不上')
  if (!claims.sub) throw new Error('ID token 里没有账号标识')
  return { sub: claims.sub, email: claims.email ?? '' }
}

// ── 刷新和退出 ──

export function credsFromTokens(t: TokenResponse, base: { clientId: string; sub: string; email: string; nowMs: number; idToken?: string }): ChatGPTCreds {
  return {
    clientId: base.clientId,
    sub: base.sub,
    email: base.email,
    idToken: t.id_token ?? base.idToken ?? '',
    accessToken: t.access_token ?? '',
    refreshToken: t.refresh_token ?? '',
    expiresAt: base.nowMs + (t.expires_in ?? 3600) * 1000,
    scopes: (t.scope ?? '').split(/\s+/).filter(Boolean),
  }
}

// ── 模型和推理 ──

export function parseChatGPTModels(text: string): ChatGPTModel[] {
  try {
    const body = JSON.parse(text) as { models?: { slug?: unknown; display_name?: unknown; visibility?: unknown }[] }
    return (body.models ?? [])
      .filter(m => m.visibility === 'list' && typeof m.slug === 'string')
      .map(m => ({ slug: m.slug as string, name: typeof m.display_name === 'string' ? m.display_name : (m.slug as string) }))
  } catch {
    return []
  }
}

/** 从 Responses API 的流式回复（SSE）里拼出文本；必须收到 response.completed 才算成功 */
export function parseResponseStream(text: string): string {
  let out = ''
  let completed = false
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter(l => l.startsWith('data:'))
      .map(l => l.slice(5).trim())
      .join('\n')
    if (!data || data === '[DONE]') continue
    let ev: { type?: string; delta?: unknown; response?: { error?: { code?: string; message?: string } }; error?: { code?: string; message?: string } }
    try {
      ev = JSON.parse(data) as typeof ev
    } catch {
      continue
    }
    if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') out += ev.delta
    else if (ev.type === 'response.completed') completed = true
    else if (ev.type === 'response.failed' || ev.type === 'error') {
      const err = ev.response?.error ?? ev.error
      const code = err?.code ?? 'unknown_error'
      if (code === 'subscription_sharing_usage_limit_exceeded') throw new Error('ChatGPT 订阅额度已用完（或超过了你给这个应用设的上限）')
      if (code === 'subscription_sharing_usage_unavailable') throw new Error('这个 ChatGPT 账号现在不能用订阅额度')
      throw new Error(`ChatGPT 返回错误：${err?.message ?? code}`)
    } else if (ev.type === 'response.incomplete') throw new Error('ChatGPT 的回复没有完成')
  }
  if (!completed) throw new Error('ChatGPT 的回复没有完成')
  return out.trim()
}

