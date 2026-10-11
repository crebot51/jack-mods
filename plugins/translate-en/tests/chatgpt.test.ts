import { describe, expect, test } from 'claude-code/testing'

import {
  authorizeUrl,
  bytesFromB64url,
  callbackFromOutput,
  chunkBlob,
  chunkCount,
  keychainWriteScript,
  decodeJwt,
  parseChatGPTModels,
  parseResponseStream,
  pkce,
  readCallback,
  verifyIdToken,
  verifyRs256,
} from '../hooks/chatgpt'

// 测试专用：临时生成的 RSA 公钥和用它签的 ID token，和真实账号无关
const FIXTURE = {"jwk":{"kty":"RSA","n":"v6LfGtgkmp3XRk7fr821I2ZnocThGeSxd3JcPyTUxbDdg44MR0GPGfjwanTzHmOFvuWmKze3IN9LiMJst76U-j3KnUVO05vbnpPtDrXQgWnywm7y1J_8j-Wv1Giyya90fGwOFUrxdoTtYF2P19JUJuflzYMxpbug1-pTLSoLnQt9ihIut3mNIQPX2mPWaEZbN_JGOaYIXC2jTbVn5-89khsX8kEGgGDCZMDgi_OH20242vxGTLPNlp1TCxXuDYMvPwQeKntChKEjO6D-X9Tus8yof00Uj9iCLksQpXxBhx3RKMR65qSn4mqZ4ibIkf8uW-nNicE3-VaAnicAQY09QQ","e":"AQAB","kid":"test-kid","alg":"RS256"},"token":"eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3Qta2lkIiwidHlwIjoiSldUIn0.eyJpc3MiOiJodHRwczovL2F1dGgub3BlbmFpLmNvbSIsImF1ZCI6WyJvYWlhcHBfdGVzdCJdLCJleHAiOjQxMDI0NDQ4MDAsIm5vbmNlIjoibjBuY2UiLCJzdWIiOiJ1c2VyLTEyMyIsImVtYWlsIjoidXNlckBleGFtcGxlLmNvbSJ9.b1POjXTDNNme9bBQYCmT60RfY8_PikX0RGnGhUbNlLS12NCj3bJ0XZUrcaaEdQ9sYYZVqKOxGnZZvYcKoGgk84frmOcls4dqU_DSslaF0PhLCYWYUTQOR_of3Idcs6lnvgHzt6MOVbp5JZmw6Y6aQ2z4Q_KB9we_wHWfgKVo7M5lMg0M1y_Xf_PB81W5iOQTk18cGGnf60rlU4zSbeKucpqWo1NYeQPM_tPlmsal6U3unFrx6dTHPEMSqqXt5-OvGgd8TpxHqKemeO0mGaswwh3o9hV_x1nv1r48uuxVzozejJKD1Z0Ym3gHyhacf61un4LqMYXVpKf-2obPynIkYw"} as const

describe('chatgpt 登录', () => {
  test('授权地址：首次注册和再次登录', async () => {
    const first = new URL(authorizeUrl({ hostId: 'urn:uuid:h', redirectUri: 'http://127.0.0.1:1455/auth/callback', state: 's', nonce: 'n', challenge: 'c', idTokenHint: 'x' }))
    expect(first.origin + first.pathname).toBe('https://auth.openai.com/api/accounts/authorize')
    expect(first.searchParams.get('client_id')).toBe('dynamic_agent_client')
    expect(first.searchParams.get('agent_name_hint')).toBe('Claude Translate EN')
    expect(first.searchParams.get('id_token_hint')).toBeNull()
    expect(first.searchParams.get('scope')).toBe('openid profile email offline_access resource.invoke chatgpt.tokens.use.direct')
    expect(first.searchParams.get('resource')).toBe('https://api.openai.com/v1')
    expect(first.searchParams.get('code_challenge_method')).toBe('S256')
    const again = new URL(authorizeUrl({ clientId: 'oaiapp_1', hostId: 'urn:uuid:h', redirectUri: 'r', state: 's', nonce: 'n', challenge: 'c', idTokenHint: 'tok', loginHint: 'a@b.c' }))
    expect(again.searchParams.get('client_id')).toBe('oaiapp_1')
    expect(again.searchParams.get('agent_name_hint')).toBeNull()
    expect(again.searchParams.get('id_token_hint')).toBe('tok')
    expect(again.searchParams.get('login_hint')).toBe('a@b.c')
  })

  test('PKCE：challenge 是 verifier 的 SHA-256', async () => {
    const { verifier, challenge } = await pkce()
    expect(verifier.length).toBeGreaterThan(42)
    expect(bytesFromB64url(challenge).length).toBe(32)
  })

  test('回调：state 对不上、用户取消、成功', async () => {
    expect(readCallback('/auth/callback?code=c&state=bad', 'good')).toEqual({ ok: false, reason: '回调的 state 对不上，已放弃这次登录' })
    expect(readCallback('/auth/callback?error=access_denied&state=good', 'good')).toEqual({ ok: false, reason: '你在浏览器里取消了授权' })
    expect(readCallback('/auth/callback?code=c1&state=good&client_id=oaiapp_9', 'good')).toEqual({ ok: true, code: 'c1', clientId: 'oaiapp_9' })
    expect(callbackFromOutput('READY\nCALLBACK /auth/callback?code=1&state=2\n')).toBe('/auth/callback?code=1&state=2')
    expect(callbackFromOutput('READY\nTIMEOUT\n')).toBeUndefined()
  })

  test('ID token：RS256 验签和各项声明', async () => {
    const { signingInput, signature } = decodeJwt(FIXTURE.token)
    expect(await verifyRs256(signingInput, signature, FIXTURE.jwk)).toBe(true)
    expect(await verifyRs256(signingInput + 'x', signature, FIXTURE.jwk)).toBe(false)
    const keys = [FIXTURE.jwk]
    const now = Date.UTC(2026, 9, 11)
    expect(await verifyIdToken(FIXTURE.token, keys, { clientId: 'oaiapp_test', nonce: 'n0nce', nowMs: now })).toEqual({ sub: 'user-123', email: 'user@example.com' })
    await expect(verifyIdToken(FIXTURE.token, keys, { clientId: 'other', nonce: 'n0nce', nowMs: now })).rejects.toThrow('受众')
    await expect(verifyIdToken(FIXTURE.token, keys, { clientId: 'oaiapp_test', nonce: 'x', nowMs: now })).rejects.toThrow('nonce')
    const [h, p, s] = FIXTURE.token.split('.')
    const flipped = s!.slice(0, 10) + (s![10] === 'A' ? 'B' : 'A') + s!.slice(11)
    await expect(verifyIdToken([h, p, flipped].join('.'), keys, { clientId: 'oaiapp_test', nonce: 'n0nce', nowMs: now })).rejects.toThrow('签名')
  })

  test('模型列表只留 visibility=list，保持服务端顺序', async () => {
    const text = JSON.stringify({ models: [
      { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' },
      { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' },
      { slug: 'gpt-6-luna', display_name: 'GPT-6 Luna', visibility: 'list' },
    ] })
    expect(parseChatGPTModels(text)).toEqual([{ slug: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' }, { slug: 'gpt-6-luna', name: 'GPT-6 Luna' }])
  })

  test('流式回复：拼出文本；没有 completed 或额度用完都报错', async () => {
    const sse = (evs: object[]) => evs.map(e => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join('')
    expect(parseResponseStream(sse([
      { type: 'response.output_text.delta', delta: 'Hello, ' },
      { type: 'response.output_text.delta', delta: 'world' },
      { type: 'response.completed' },
    ]))).toBe('Hello, world')
    expect(() => parseResponseStream(sse([{ type: 'response.output_text.delta', delta: 'Hi' }]))).toThrow('没有完成')
    expect(() => parseResponseStream(sse([{ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }]))).toThrow('额度')
  })

  test('钥匙串：长凭证拆段，每行都不超过 security 的 4096 字符上限', async () => {
    const blob = 'a'.repeat(9000)
    const chunks = chunkBlob(blob)
    expect(chunks.length).toBe(3)
    expect(chunks.join('')).toBe(blob)
    const lines = keychainWriteScript(chunks).trim().split('\n')
    expect(lines.length).toBe(4)
    for (const l of lines) expect(l.length).toBeLessThan(4000)
    expect(lines[0]).toContain('-a chatgpt.0 ')
    expect(lines[3]).toContain('-a chatgpt ')
    expect(lines[3]?.endsWith('-w chunks:3')).toBe(true)
    expect(chunkCount('chunks:3')).toBe(3)
    expect(chunkCount('eyJhIjoxfQ')).toBeUndefined()
  })
})
