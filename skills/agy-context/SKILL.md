---
name: agy-context
description: >-
  Open the Antigravity Context sidecar panel to inspect cross-session context
  insights, per-request token timeline (Total/Delta/Overview), Context Browser
  and DNA view, context events, file activity, and command executions.
---

# Antigravity Context (`agy-context`)

Use this skill when the user wants to inspect context composition, cross-session usage insights, timeline evolution, file activity, or command executions inside Antigravity App.

## Opening the Panel

When the `agy-context` plugin and its `context_panel` sidecar are enabled and running, present a clickable pill to toggle the side pane (`AUX_PANE`):

[Antigravity Context](sidecar://agy-context/context_panel/)

Users can also open the full-width **Context Insights** dashboard (`SIDEBAR` view) from **Plugins > Context Insights** in the left sidebar, or via the side panel **`+`** menu.

## If the Sidecar Is Not Enabled Yet

Guide the user to enable the plugin and sidecar in Customizations:

1. Open [Antigravity Context](customization://agy-context).
2. Ensure the plugin is enabled and turn on the **Antigravity Context** sidecar.
3. Open **Context** from the side panel **`+`** menu or **Context Insights** in the left sidebar.
