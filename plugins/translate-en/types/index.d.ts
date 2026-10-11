/** 翻译接口的设置，存在 $.store 里跨会话保留 */
export type TranslateConfig = {
  /** 是否在发送前翻译 */
  enabled: boolean
  /** OpenAI 兼容接口地址，例如 https://api.openai.com/v1 */
  baseUrl: string
  apiKey: string
  model: string
  /** 附一条只给 Claude 看的说明：用户在学中文，请用中文回复，并附上原文 */
  replyInChinese: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'translate-en': {
      isOpen: boolean
      config: TranslateConfig
      models: string[]
      modelQuery: string
      notice: string
      busy: boolean
    }
  }
}
