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
| First message after 65 minutes away, 61K tokens, a subscription's 1-hour cache | $0.244 (all 61K tokens written again), first token in 5.8 s | $0.013 including the one ping at 59 minutes, first token in 3.3 s |
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
- **The pane** (`/pennycrab` shows or hides it; it opens by itself when a wave of subagents starts, where it docks beside the conversation, so not on the terminal's main screen): the session's cost, what was saved and the main context at the top; a line on the cache; one row per subagent, running ones first, with its model, where it was routed from, the tool it is using, its context, cost and time. A subagent stopped at its budget moves under **Guard**.
- **The band above the prompt**: the crabs at work and how many, what was spent and saved, and the **Pane** and **⚙ Settings** buttons. Settings has one menu per option below, each with what its value does, and **Reset to defaults**; `/pennycrab settings` opens it too.
- **The status line**: up to two running subagents with their model's letter, context and time, then what was saved.

## Options

Set them from **⚙ Settings** on the band, in the config menu, or with `/plugin configure pennycrab`. A change reloads pennycrab with it.

| Option | Values | Default | What it does |
| --- | --- | --- | --- |
| `router` | `auto`, `explore`, `prudent`, `off` | `auto` | `auto`: Explore runs on Haiku at low effort from any model above it; general-purpose runs on Sonnet from Opus or Fable. `explore`: Explore as in `auto`, general-purpose keeps your model. `prudent`: both on Sonnet, from Opus or Fable only. Never a model above yours. A subagent type you defined, an explicit model in the Agent call, a fork, `CLAUDE_CODE_SUBAGENT_MODEL`, Bedrock, Vertex and Foundry are left alone. |
| `budget` | `0.50`, `1`, `2`, `5` (USD), `off` | `2` | The most one subagent may spend. Past it, a subagent that wants to go on gets its tool calls refused with a note to write its final answer from what it found. If it keeps calling tools, its third request after that is answered by pennycrab, which ends its turn. |
| `keepWarm` | `auto`, `30m`, `1h`, `2h`, `4h`, `8h`, `off` | `auto` | `auto`: pings while the pings of one absence cost at most a quarter of the rewrite they spare, for 8 hours at most. How far that reaches depends on the model's cache prices. On a 5-minute cache: about 26 minutes on Opus 5.5 and Sonnet 5.5, 56 on Fable 5.1, 13 on Haiku and on the older models whose cache reads cost a tenth of input. On a subscription's 1-hour cache, one ping an hour: 8 hours on the 5.5 models and Fable 5.1, about 5 on the others. A time: pings for that long after your last turn. |
| `band` | `always`, `working`, `off` | `always` | When the band above the prompt shows: always, only while subagents run, or never. |
| `statusLine` | `on`, `off` | `on` | The crabs at work and their time on the status line. |
| `autoOpen` | `on`, `off` | `on` | Whether the pane opens by itself when a wave of subagents starts. |

## How the numbers are counted

- **Prices** come from Anthropic's pricing page ([pricing.md](https://platform.claude.com/docs/en/about-claude/pricing.md)). pennycrab reads its model table at the start of a session once its kept prices are a day old, again every ten minutes while it cannot reach the page, and keeps it for later sessions. Each model version has its own prices, and Haiku 5.5's higher price past 100K prompt tokens comes from the page too. No price is written in the code: when the page cannot be reached the kept prices are used, and with none kept, or for a model the page does not list, a subagent's cost shows `?` rather than a guess. The budget cannot apply to a cost it does not know.
- **Cost** of a subagent is priced per request from the API's token counts. The session's total is Claude Code's own, as `/cost` shows it.
- **Saved** adds two things. For a routed subagent, the gap between what each request cost and what the same tokens would have cost on the model it would have run on: your session's, or Opus for an Explore under Fable, where Claude Code runs it on Opus. For the cache, the cost of rewriting what your next message read from the cache, counted only when the cache would have expired without the pings, minus what every ping cost. Pings for a session you never come back to are a cost, and the pane shows them, as a loss (−$0.02) when they spared nothing.
- **The first ping after a turn** can write a part of the conversation to the cache again, once: what a ping sends is the conversation as the transcript holds it, which can differ a little from how the turn's own request went out. `auto` counts that cost, so that ping alone can come close to the quarter.
- **On a subscription** nothing is billed per token: the dollars are list-price equivalents of what counts against your plan's 5-hour and weekly limits.
- **The cache's lifetime** is read the way Claude Code decides it: `FORCE_PROMPT_CACHING_5M`, then `CLAUDE_CODE_PROMPT_CACHE_TTL`, then the `promptCacheTtl` setting, then `ENABLE_PROMPT_CACHING_1H`, then your account: 1 hour on a Claude subscription within its limits, 5 minutes on an API key, a cloud provider, or a subscription past its limits.

## What goes over the network

- Once a day at most, a plain GET of the pricing page. Nothing is sent.
- Each keep-warm ping is one request to the model through your own session, like a short message: it counts toward your cost or your plan's limits, and the pane shows how many were sent and what they cost. A ping the API refuses (overloaded, rate limited) is tried again 15 seconds later, until the cache would have expired. None goes out after `/model` moves the session to another model family, which has no cache to keep.

## Develop

```
claude plugin validate .
claude plugin test .
```

To run it from this folder: `claude --plugin-dir <this folder>`, or, for the desktop app, `CLAUDE_CODE_PLUGIN_DIRS=<this folder>` in the `env` block of `~/.claude/settings.json`. Options for a plugin loaded this way are stored under `pluginConfigs["pennycrab@inline"]`. `docs/PIANO.md` holds the measurements and the plan.

## License

MIT
