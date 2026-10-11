# jack-mods

[Chinese (Simplified)](README.md) · **English** · [Russian](README.ru.md) · [Persian](README.fa.md)

My own Claude Code mods.

All three sit next to the model name below the prompt box: ⚡ quick-commands, 🪙 token-band (when collapsed), 🌐 translate-en.

![Toolbar buttons](docs/toolbar-buttons.png)

## token-band

A live token-usage band above the prompt box:

![Expanded](docs/token-band-expanded.png)

Click the collapse button and the whole band disappears; only a 🪙 is left at the right of the toolbar below the prompt box. Click it to expand again:

![Collapsed](docs/token-band-collapsed.png)

```
271.1k/1.00M (27%) · this turn 3.3k · 113 tok/s · total in 7.92M · total out 38.4k · cache 98% · $8.58 · 5h 99% · 7d 70% ✅   [collapse]
```

> The band's labels in the screenshots are currently Chinese; the line above shows the same fields in English, in the same order.

| Item | Meaning |
|---|---|
| `271.1k/1.00M (27%)` | Current context size / model window |
| this turn | Output tokens generated so far this turn, ticking up while the reply streams |
| `tok/s` | Average output speed: total output ÷ total generation time (first to last token, excluding time to first token) |
| total in / total out | Session totals, including cache reads/writes and subagents |
| cache | Share of total input served from cache; higher is cheaper |
| `$` | Session cost |
| `5h` / `7d` | Share of the 5-hour / 7-day subscription limit used (hidden on API billing) |
| `✅` / `❌` | Model check: turns ❌ and shows a toast with the reason when the main thread was switched to another model, the model returned by the API differs from the one requested, or thinking effort was silently lowered |

- On narrow windows the band wraps to two lines, with the collapse button pinned to the right of the first line.
- You can also type `/tokens` to toggle between expanded and collapsed.

## quick-commands

Adds a ⚡ button to the right of the model name. It opens a side panel so you don't have to type `/xxx` by hand:

- **Commands tab**: lists every slash command in the current session (built-in, your own, plugins and skills, MCP), grouped and searchable.
  - Common built-ins (`/compact`, `/clear`, `/context`, `/cost`, `/resume`, …) run with one click.
  - Everything else (skills, plugin and MCP commands) only fills `/name ` into the prompt box so you can add arguments and send it yourself. Nothing fires by accident.
  - The `⋯` next to a built-in lets you type arguments; when a command's output lists "Available: a, b, c" the mod remembers it and shows those as buttons next time.
- **Settings tab**: the `/config` settings as click targets. Toggles get On / Off, pick-one settings get one button per option, text and number settings get an input box. The current value has a blue background.
- **Chinese / English**: the UI follows `language` in `settings.json` or the system language by default; the 🌐 button switches between Auto / Chinese / English by hand. In Chinese, the English command and setting descriptions are translated with haiku and cached. In English, the engine's own descriptions are shown untouched.
- Click ⚡ to open; click it again (now ✕) or press Esc to close.

The ⚡ button, to the right of the model name:

![Button](docs/quick-commands-button.png)

The panel in English (descriptions and setting names are the engine's originals, unchanged):

![Commands tab (English)](docs/quick-commands-commands-en.png)
![Settings tab (English)](docs/quick-commands-settings-en.png)

## translate-en

Translates every message you send into English before it reaches Claude, using **your own model access**, not your Claude subscription. Made for someone learning Chinese: type in Chinese, Claude reads English and replies in Chinese.

- A 🌐 button always sits next to the model name, from the moment a session opens. It is dimmed when translation is off or not set up yet.
- Click it to open the settings panel and pick where translations come from:
  - **OpenAI-compatible API**: Base URL, API key, and a model fetched from `/models` (or typed by hand).
  - **ChatGPT subscription**: *Continue with ChatGPT* opens your browser to sign in with ChatGPT (Plus / Pro) and allow plan usage; no API key. Models come from your account. It follows OpenAI's [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source) flow for open-source local apps (PKCE, loopback callback on `127.0.0.1`, ID token signature check). macOS only.
  - A Test button translates a sample sentence with the current setup.
- What gets translated: messages you type, and the arguments of skill, plugin, MCP and your own slash commands (plus `/compact`'s instructions). English-only text, other built-in commands' arguments (`/model`, `/resume`, ...) and background notifications are left as they are.
- Claude only ever sees the English translation; the transcript shows it too. The session's system prompt says once that the user is an American who wants to learn Chinese and should get replies in Simplified Chinese. Nothing tells Claude that messages were translated, so it can't tell what language you typed in.
- If translation fails or takes longer than 9 seconds, the original text is sent and a toast says why.
- Requests to OpenAI-compatible APIs carry a stable `x-opencode-session` header and their own User-Agent, as OpenCode Go requires; other providers ignore them. Only `/chat/completions` is used there, and OpenCode's free-tier models refuse calls from outside OpenCode.

> The panel's labels are currently Chinese.
>
> Storage: the API key is kept **in plain text** in the plugin's local store (`~/.claude/plugins/store/translate-en_*.json`, readable only by your macOS user). ChatGPT sign-in credentials are kept **in the macOS Keychain** (`claude-translate-en`). To cut off a ChatGPT sign-in, use *Sign out* in the panel or disconnect the app in [ChatGPT settings](https://chatgpt.com/settings/usage).

## Install

### Requirements

- [Claude Code](https://code.claude.com) installed, with `claude` working in a terminal. The mods run in both the terminal and the desktop app.
- translate-en needs either an OpenAI-compatible API (Base URL + key) or a ChatGPT Plus / Pro plan. Signing in with ChatGPT works on macOS only; it uses the `perl` and `security` tools that come with macOS.

### Install all three (recommended)

Paste into a terminal:

```bash
claude plugin marketplace add crebot51/jack-mods && claude plugin install token-band@jack-mods && claude plugin install quick-commands@jack-mods && claude plugin install translate-en@jack-mods
```

This adds the `jack-mods` marketplace (needed once), then installs the three mods for your user, so every project gets them.

### Install only some

Add the marketplace once, then install just the ones you want:

```bash
claude plugin marketplace add crebot51/jack-mods
```

```bash
claude plugin install token-band@jack-mods
```

```bash
claude plugin install quick-commands@jack-mods
```

```bash
claude plugin install translate-en@jack-mods
```

### After installing

1. Start a **new** session. A session that was already open keeps the mods it started with; run `/reload-plugins` in it, or open a new one.
2. Check what you got:
   - **token-band**: the usage band above the prompt box. On desktop it appears after your first message.
   - **quick-commands**: a ⚡ next to the model name.
   - **translate-en**: a 🌐 next to the model name, dimmed until it is set up.
3. Set up translate-en: click 🌐, then
   - pick **OpenAI-compatible API** and fill in Base URL and key (press Save on each), then *Fetch model list* and pick a model; **or**
   - pick **ChatGPT subscription**, click *Continue with ChatGPT*, sign in in the browser and allow plan usage, then pick a model;
   - click *Test*, then turn the status switch on. The 🌐 is no longer dimmed.

To see what is installed:

```bash
claude plugin list
```

### Update

Fetch the latest marketplace, then update each mod:

```bash
claude plugin marketplace update jack-mods && claude plugin update token-band@jack-mods && claude plugin update quick-commands@jack-mods && claude plugin update translate-en@jack-mods
```

Then start a new session, or run `/reload-plugins` in an open one.

### Uninstall

One mod: `claude plugin uninstall <name>@jack-mods`

All three, and the marketplace:

```bash
claude plugin uninstall token-band@jack-mods && claude plugin uninstall quick-commands@jack-mods && claude plugin uninstall translate-en@jack-mods && claude plugin marketplace remove jack-mods
```

If you signed in with ChatGPT in translate-en, click *Sign out* in its panel before uninstalling, so the sign-in is revoked and removed from the Keychain. Otherwise disconnect the app in [ChatGPT settings](https://chatgpt.com/settings/usage) and delete the `claude-translate-en` entries in Keychain Access.

### Troubleshooting

| What you see | What to do |
|---|---|
| No ⚡ / 🌐 / band after installing | The session was open before the install: run `/reload-plugins` or start a new session. |
| token-band shows nothing on desktop | Send one message; the band appears after the first turn. |
| 🌐 stays dimmed | translate-en is off or not set up: open the panel, finish the setup, turn the status switch on. |
| A toast says translation failed and the original was sent | The panel's *Test* button shows the provider's error. With OpenCode, free-tier models only work inside OpenCode; pick a paid model. |
| *Continue with ChatGPT* fails | Make sure your plan is Plus or Pro and you allowed plan usage in the browser; if macOS asks about the Keychain, allow it. Then try again. |
| `claude plugin install` says the plugin is not found | Run `claude plugin marketplace update jack-mods` and try again. |

> The mod API is an early preview and may need updates across Claude Code versions.
