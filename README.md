# pennycrab

The crab that counts your pennies. A Claude Code mod that:

- **routes subagents to cheaper models**: the built-in Explore, which only reads and searches, runs on Haiku; general-purpose runs on Sonnet when your session is on Opus or Fable;
- **stops runaway subagents**: past a budget, a subagent is asked to hand back what it found, and stopped if it keeps going;
- **keeps the prompt cache warm** while you are away, so your next message reads the conversation from the cache instead of writing it again. It adapts to your account: one ping an hour on a Claude subscription's 1-hour cache, a few pings on a pay-per-token 5-minute cache, and only as long as the pings cost less than a quarter of the rewrite they spare;
- **shows it all in a live pane**: one crab per subagent, dressed for the model it runs on, with its context, cost and time.

## Install

In a terminal session of Claude Code:

```
/plugin install pennycrab --marketplace Batman110391/pennycrab
```

Answer `y` to add the marketplace, then pick a scope. In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `Batman110391/pennycrab`, then **Add plugin**.

Type `/pennycrab` to show or hide the pane. It also opens by itself when a wave of subagents starts. After your first turn a toast says what pennycrab found and chose for your account (subscription or pay-per-token, cache length, router, budget); it shows again only when that changes.

## Options

Set them in the config menu, or with `/plugin configure pennycrab`.

| Option | Values | Default | What it does |
| --- | --- | --- | --- |
| `router` | `auto`, `prudent`, `off` | `auto` | `auto`: Explore runs on Haiku at low effort from any model above it (Sonnet, Opus, Fable); general-purpose runs on Sonnet from Opus or Fable. `prudent`: both on Sonnet, from Opus or Fable only. Never a model above yours; a subagent type you defined, an explicit model, a fork, `CLAUDE_CODE_SUBAGENT_MODEL`, Bedrock, Vertex and Foundry are left alone. |
| `budget` | `0.50`, `1`, `2`, `5` (USD), `off` | `2` | The most one subagent may spend. Past it, a subagent that wants to go on is handed over: its tool calls are refused with a note to write its final answer from what it found. If it keeps calling tools, its third request after that is answered by pennycrab, which ends its turn. |
| `keepWarm` | `auto`, `30m`, `1h`, `2h`, `4h`, `8h`, `off` | `auto` | Shortly before the main conversation's cache would expire, pennycrab sends one ping that reads it, which renews it. `auto`: as long as the pings of one absence cost at most a quarter of the rewrite they spare, up to 8 hours: about half an hour on a 5-minute cache, up to 8 hours (one ping an hour) on a subscription's 1-hour cache. A time: that long after your last turn. |

## How the numbers are counted

- **Prices** come from Anthropic's own pricing page ([pricing.md](https://platform.claude.com/docs/en/about-claude/pricing.md)): pennycrab reads its model table at the start of a session, at most once a day, and keeps it for the next sessions. Each model version has its own prices (Opus 5 and Opus 5.5 differ), and Haiku 5.5's higher price past 100K prompt tokens comes from the page too. No price is written in the code: when the page cannot be reached the kept prices are used, and with none kept a subagent's cost shows `?` rather than a guess. The request is a plain GET of that page; nothing is sent.
- **Cost** of a subagent is priced per request from the API's token counts. The session's total cost is Claude Code's own, as `/cost` shows it.
- **Saved** adds two things. For a routed subagent, it is the gap between what each request cost and what it would have cost on your model. For the cache, it is the cost of rewriting what your next message read from the cache, counted only when the cache would have expired without the pings, minus what every ping cost. Pings for a session you never come back to are a cost: the pane shows them.
- **The cache's lifetime** is read the way Claude Code decides it: `FORCE_PROMPT_CACHING_5M`, then `CLAUDE_CODE_PROMPT_CACHE_TTL`, then the `promptCacheTtl` setting, then `ENABLE_PROMPT_CACHING_1H`, then your account (1 hour on a Claude subscription within its limits, 5 minutes on an API key or a cloud provider). On a 1-hour cache the default 30-minute window needs no ping at all.

## Develop

```
claude plugin validate .
claude plugin test .
```

To run it from this folder: `claude --plugin-dir <this folder>`, or, for the desktop app, `CLAUDE_CODE_PLUGIN_DIRS=<this folder>` in the `env` block of `~/.claude/settings.json`. Options for a plugin loaded this way are stored under `pluginConfigs["pennycrab@inline"]`.

## License

MIT
