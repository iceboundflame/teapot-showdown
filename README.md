# Teapot Showdown

Match the solid teapot to the ghost as many times as you can before the clock
runs out. A mini-game for comparing 3D input devices: play with a regular
mouse, a 3Dconnexion SpaceMouse, or a [Rotatrix](https://rotatrix.com) via
OpenAxis.

**Play it:** the built game is committed to [`docs/`](docs/) — with GitHub
Pages set to serve `main` / `docs`, it runs as-is at
`https://<user>.github.io/teapot-showdown/`.

## Game modes

- **Rotation only** — the target is shown for a moment, then hidden; rotate
  from memory
- **Translation only** — move the teapot onto the ghost
- **Rotation + translation** — full 6DoF matching

Every session is recorded locally (browser localStorage). Daily and all-time
leaderboards, plus a [stats page](stats.html) with per-device median motion
graphs. By default the boards are personal — your highest scores, dated, no
name entry. **Booth mode** (in the options) adds per-run name entry and staff
claim chips for running it as a public station.

## Inputs

- **Mouse** — virtual trackball (Holroyd) or tumbler rotation, drag/wheel
  translation
- **SpaceMouse** — needs the 3DxWare driver; the 3DconnexionJS SDK is not
  redistributed and is loaded from 3dconnexion.com
- **Rotatrix** — connects to the local OpenAxis WebSocket server that the
  Rotatrix app runs. The game publishes the `app.teapot_showdown` tag; add
  [`rotatrix-profile.yaml`](rotatrix-profile.yaml) to your Rotatrix config to
  bind it (instructions in the file, and in the in-game setup link)

## Development

```bash
pnpm install
pnpm dev        # http://localhost:5189
pnpm build      # rebuilds docs/ (commit it)
```

The OpenAxis browser client (`lib/openaxis-client/`) is a vendored copy of
the OpenAxis TypeScript client, v0.2 (the OpenAxis protocol and client
libraries are not yet published separately).
