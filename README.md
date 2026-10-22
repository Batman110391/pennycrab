# pennycrab

The crab that counts your pennies. A Claude Code mod that:

- **routes subagents to cheaper models**: built-in Explore and general-purpose subagents of an Opus or Fable session run on Sonnet;
- **stops runaway subagents**: past a budget, a subagent is asked to hand back what it found, and stopped if it keeps going;
- **keeps the prompt cache warm** while you are away, so your next message reads the conversation from the cache instead of writing it again;
- **shows it all in a live pane**: one crab per subagent, dressed for the model it runs on, with its context, cost and time.

## Install

In a terminal session of Claude Code:

```
/plugin install pennycrab --marketplace Batman110391/pennycrab
```

Answer `y` to add the marketplace, then pick a scope. In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `Batman110391/pennycrab`, then **Add plugin**.

Type `/pennycrab` to show or hide the pane. It also opens by itself when a wave of subagents starts.

## Options

Set them in the config menu, or with `/plugin configure pennycrab`.

| Option | Values | Default | What it does |
| --- | --- | --- | --- |
| `router` | `prudent`, `aggressive`, `off` | `prudent` | `prudent`: Explore and general-purpose run on Sonnet when your session runs on Opus or Fable. `aggressive`: Explore also drops to Haiku at low effort. Never a model above yours; a subagent type you defined, an explicit model, a fork, `CLAUDE_CODE_SUBAGENT_MODEL`, Bedrock, Vertex and Foundry are left alone. |
| `budget` | `0.50`, `1`, `2`, `5` (USD), `off` | `2` | The most one subagent may spend. Past it, or past the prompt length where its model bills higher (Haiku 5.5's 100K, as the pricing page states it), a subagent that wants to go on is handed over: its tool calls are refused with a note to write its final answer from what it found. If it keeps calling tools, its third request after that is answered by pennycrab, which ends its turn. |
| `keepWarm` | `off`, `15m`, `30m`, `1h`, `2h` | `30m` | How long after your last turn the main conversation's cache stays warm. Shortly before the cache would expire, pennycrab sends one ping that reads it, which renews it. |

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
