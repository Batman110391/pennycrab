# pennycrab

The crab that counts your pennies: a Claude Code mod that makes the same work cost less, and shows you where the money goes.

- **Explore runs on Haiku.** The built-in Explore subagent only reads and searches, so it runs on the cheapest model, whatever model your session uses. General-purpose subagents, which also edit, run on Sonnet when your session is on Opus or Fable.
- **Your cache stays warm while you are away.** Shortly before the conversation's prompt cache would expire, one small ping renews it, so the message you send when you come back reads the conversation from the cache instead of paying to write it again. It adapts to your account: one ping an hour on a Claude subscription's 1-hour cache, a few pings on a pay-per-token 5-minute cache, and only as long as they cost less than a quarter of the rewrite they spare.
- **Runaway subagents stop at a budget.** Past $2 (your choice), a subagent is asked to hand back what it found, and stopped if it keeps going.
- **A live pane shows it all.** One crab per subagent, dressed for the model it runs on, with its context, cost and time; what was saved; how long the cache stays warm.

## What it saved in live runs

Measured with Claude Code 2.1.308, at list prices as Claude Code computes them, one run each.

| | Without pennycrab | With pennycrab |
| --- | --- | --- |
| One Explore over 32 files, from an Opus session | $0.509, 56 s (on Opus) | $0.013, 24 s (on Haiku), the same files described |
| The same Explore on Sonnet | $0.247, 33 s | $0.013, 24 s |
| First message after an 8-minute pause, 61K tokens, 5-minute cache | $0.088 to $0.153, first token in 3.5 s | $0.019 including the pings, first token in 1.8 s |
| Explore over 109 files with a $0.50 budget | no limit | stopped at the budget, 97 files read and handed back with the 12 it skipped |
| Time added per subagent tool call | | 5 to 6 ms |

## Install

In a terminal session of Claude Code:

```
/plugin install pennycrab --marketplace Batman110391/pennycrab
```

Answer `y` to add the marketplace, then pick a scope. In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `Batman110391/pennycrab`, then **Add plugin**.

To remove it: `/plugin uninstall pennycrab`.

## What you see

- **A toast after your first message** says what pennycrab found and chose: a Claude subscription or pay-per-token use, how long your cache lasts, where Explore and general-purpose run, the budget. It shows again only when one of those changes.
- **The pane** (`/pennycrab` shows or hides it; it opens by itself when a wave of subagents starts): the session's cost, what was saved and the main context at the top; a line on the cache; one row per subagent, running ones first, with its model, where it was routed from, the tool it is using, its context, cost and time. A subagent stopped at its budget moves under **Guard**.
- **The band above the prompt** while subagents run: their crabs, how many are running, the main context and what was saved.
- **The status line**: up to two running subagents with their model's letter, context and time, then what was saved.

## Options

Set them in the config menu, or with `/plugin configure pennycrab`.

| Option | Values | Default | What it does |
| --- | --- | --- | --- |
| `router` | `auto`, `prudent`, `off` | `auto` | `auto`: Explore runs on Haiku at low effort from any model above it; general-purpose runs on Sonnet from Opus or Fable. `prudent`: both on Sonnet, from Opus or Fable only. Never a model above yours. A subagent type you defined, an explicit model in the Agent call, a fork, `CLAUDE_CODE_SUBAGENT_MODEL`, Bedrock, Vertex and Foundry are left alone. |
| `budget` | `0.50`, `1`, `2`, `5` (USD), `off` | `2` | The most one subagent may spend. Past it, a subagent that wants to go on gets its tool calls refused with a note to write its final answer from what it found. If it keeps calling tools, its third request after that is answered by pennycrab, which ends its turn. |
| `keepWarm` | `auto`, `30m`, `1h`, `2h`, `4h`, `8h`, `off` | `auto` | `auto`: pings while the pings of one absence cost at most a quarter of the rewrite they spare, for 8 hours at most. That is about half an hour on a 5-minute cache and up to 8 hours, one ping an hour, on a subscription's 1-hour cache. A time: pings for that long after your last turn. |

## How the numbers are counted

- **Prices** come from Anthropic's pricing page ([pricing.md](https://platform.claude.com/docs/en/about-claude/pricing.md)). pennycrab reads its model table at the start of a session, at most once a day, and keeps it for later sessions. Each model version has its own prices, and Haiku 5.5's higher price past 100K prompt tokens comes from the page too. No price is written in the code: when the page cannot be reached the kept prices are used, and with none kept a subagent's cost shows `?` rather than a guess.
- **Cost** of a subagent is priced per request from the API's token counts. The session's total is Claude Code's own, as `/cost` shows it.
- **Saved** adds two things. For a routed subagent, the gap between what each request cost and what the same tokens would have cost on your model. For the cache, the cost of rewriting what your next message read from the cache, counted only when the cache would have expired without the pings, minus what every ping cost. Pings for a session you never come back to are a cost, and the pane shows them.
- **On a subscription** nothing is billed per token: the dollars are list-price equivalents of what counts against your plan's 5-hour and weekly limits.
- **The cache's lifetime** is read the way Claude Code decides it: `FORCE_PROMPT_CACHING_5M`, then `CLAUDE_CODE_PROMPT_CACHE_TTL`, then the `promptCacheTtl` setting, then `ENABLE_PROMPT_CACHING_1H`, then your account: 1 hour on a Claude subscription within its limits, 5 minutes on an API key, a cloud provider, or a subscription past its limits.

## What goes over the network

- Once a day at most, a plain GET of the pricing page. Nothing is sent.
- Each keep-warm ping is one request to the model through your own session, like a short message: it counts toward your cost or your plan's limits, and the pane shows how many were sent and what they cost.

## Develop

```
claude plugin validate .
claude plugin test .
```

To run it from this folder: `claude --plugin-dir <this folder>`, or, for the desktop app, `CLAUDE_CODE_PLUGIN_DIRS=<this folder>` in the `env` block of `~/.claude/settings.json`. Options for a plugin loaded this way are stored under `pluginConfigs["pennycrab@inline"]`. `docs/PIANO.md` holds the measurements and the plan.

## License

MIT
