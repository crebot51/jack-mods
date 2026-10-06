# jack-mods

自己写的 Claude Code mods。

## token-band

在输入框上方实时显示 token 用量：

```
上下文 146.5k/1.00M (15%) │ 本轮输出 1.4k │ 均速 93.8 tok/s │ 累计 输入 10 · 输出 5.1k · 缓存读 704.0k · $2.089   [收起]
```

- **上下文**：当前占用 / 模型窗口
- **本轮输出**：这一轮已生成的 token，回复过程中实时跳动
- **均速**：总输出 token ÷ 总生成时间（从首个字到最后一个字，不含等待首字）
- **累计**：启用后的输入 / 输出 / 缓存读，含子 agent；费用为整个会话
- 点「收起」隐藏，输入 `/tokens` 可随时展开或收起

## 安装

```bash
claude plugin marketplace add crebot51/jack-mods
claude plugin install token-band@jack-mods
```

更新：`claude plugin update token-band`
卸载：`claude plugin uninstall token-band`

> mod 接口目前是早期预览，Claude Code 版本差异较大时可能需要更新。
