export type TokenStats = {
  /** 本会话累计（含子 agent） */
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** 本轮已生成的输出 token */
  turnOutput: number
  /** 当前上下文占用 */
  contextTokens: number | null
  contextWindow: number | null
  /** 测速用：计入测速的输出 token 与生成耗时（毫秒）。热重载前的旧状态里可能没有 */
  speedTokens?: number
  speedMs?: number
  /** 本会话费用（美元） */
  usd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'token-band': { stats: TokenStats; isHidden: boolean }
  }
}
