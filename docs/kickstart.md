# Kickstart: building Affinity scripts with AI

How to go from zero to an AI agent writing, pushing and debugging scripts for
**Affinity by Canva**.

## 0. Requirements

- **Affinity by Canva v3.3+**. Classic Affinity V2 has no scripting at all.
- An AI coding agent that can read files and talk to MCP. These notes use
  **Claude Code**, but any agent that supports MCP will work.

## 1. Turn on scripting in Affinity

- Settings → Scripting → **Enable Affinity Scripting** (it's off by default).
- Window → Scripting → open the **Script Editor** and the **Log Console**. You
  can run unsaved code with `Ctrl+Return` / `F5`, and the **Running Scripts**
  panel stops a script that won't end.

## 2. Turn on MCP (lets the AI talk to Affinity)

In Affinity's MCP settings, switch on:

- **Enable Affinity-MCP**
- **Network access**. You need this even though the server is local; without
  it you get `ECONNREFUSED 127.0.0.1:6767`.
- **Use saved scripts** and **Save scripts in your panel**

Affinity then runs an MCP server at `http://localhost:6767/sse`.

## 3. Script Manager (pushes `.js` files from disk into Affinity)

- Install [Affinity Script Manager](https://github.com/JiriKrblich/Affinity-Script-Manager)
  by JiriKrblich.
- Open the Scripts panel (Window → General → Scripts) and **create at least one
  category**. If you don't, it shows "Affinity not connected" even while the
  bridge says Online. This is the most common snag.
- Use **Watch Mode** so edits on disk get pushed again automatically. Otherwise
  Affinity keeps an old copy of the script.

## 4. Connect your AI

```
git clone https://github.com/olliollio/affinity-scripts
cd affinity-scripts
claude mcp add --transport sse affinity http://localhost:6767/sse
claude
```

On Windows, run the agent natively on Windows, not in WSL2. WSL can't reach
Affinity's `localhost:6767`.

## 5. Point the AI at the docs before it writes anything

This is the part that actually matters. Three knowledge sources, in order of
authority:

1. [`jslib/`](jslib/) is Affinity's own JS library source, vendored into the
   repo. These files *are* the `/application`, `/nodes`, `/commands` …
   modules scripts `require`, so it's the ground truth for the API. Start at
   `jslib/README.md`.
2. <https://sdk.affinity.studio/33000/js/> is the official SDK reference:
   signatures, types and enums.
3. [`affinity-sdk-reference.md`](affinity-sdk-reference.md) and
   [`affinity-scripting-notes.md`](affinity-scripting-notes.md) are notes on
   what the API *actually does*: quirks, crashes, and bugs that neither
   official source covers.

The working scripts (`select_same/`, `gravity/`, `examples/` …) are good
templates. Start with a prompt like:

> Read docs/affinity-scripting-notes.md and docs/jslib/README.md, then write a
> script that does X. Use select_same/ as a reference for structure.

## 6. The loop

1. The AI writes the `.js`.
2. Run it in the Script Editor.
3. Paste errors from the Log Console back to the AI.
4. Repeat.

Keep each script to one small feature and build it up step by step.
