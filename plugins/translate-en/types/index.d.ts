/** 翻译接口的设置，存在 $.store 里跨会话保留 */
export type TranslateConfig = {
  /** 是否在发送前翻译 */
  enabled: boolean
  /** OpenAI 兼容接口地址，例如 https://api.openai.com/v1 */
  baseUrl: string
  apiKey: string
  model: string
  /** 用哪种接口翻译：OpenAI 兼容接口（Base URL + Key），或 ChatGPT 订阅登录 */
  provider: Provider
  /** ChatGPT 订阅下选的模型 slug */
  chatgptModel: string
  /** 已登录的 ChatGPT 账号邮箱，只用来显示；凭证在钥匙串里 */
  chatgptEmail: string
}

export type Provider = 'openai' | 'chatgpt'

/** ChatGPT 账号可用的模型 */
export type ChatGPTModelItem = { slug: string; name: string }

declare module 'claude-code' {
  interface PluginState {
    'translate-en': {
      isOpen: boolean
      config: TranslateConfig
      models: string[]
      modelQuery: string
      notice: string
      busy: boolean
      chatgptModels: ChatGPTModelItem[]
    }
  }
}
