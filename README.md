# Social Observatory game archive

Static replays of 100 Mafia and 100 Avalon games from dataset release 0.0.1.

**Website:** https://unreleasedproducts.github.io/

The site runs entirely in the browser. It loads a small catalog, one selected game,
and that game's belief surveys on demand. It makes no model requests and needs no API keys.

## Explore a recording

- Select Mafia or Avalon, then choose a game. Search by game number, seed, or model.
- Use Next, Back, the timeline, or Play replay. Full game opens the complete transcript.
- Spectator hides role labels and private events. A player perspective includes that
  player's private events and role knowledge. Researcher reveals all roles and events.
- Beliefs show the latest survey frozen at or before the replay position. Delayed
  survey collection does not move the checkpoint.
- Copy the address bar to share the game, replay position, and perspective.

Perspectives are display filters, not access controls. The public JSON includes hidden
roles and private events. Surveys are elicited self-reports, not verified internal reasoning.

## Local preview and checks

With Python 3 and Node.js 22 or later:

```sh
python -m http.server 4175 --directory docs --bind 127.0.0.1
npm test
npm run verify
```

Open http://127.0.0.1:4175. No npm installation or build step is needed.

## Reproduce the dataset export

Download the two raw game archives from release `0.0.1` of the source repository
`unreleasedproducts/MafiaSim` using an account with access. Then run:

```sh
python -m pip install zstandard
python scripts/export_release.py /path/to/release-assets
npm run verify
```

The exporter verifies each archive against its release SHA-256 before reading it.
It selects replay fields, player/model labels, and belief reports. It omits raw model
call logs, request prompts, connection settings, and server files. The manifest records
the release, source repository, archive hashes, and per-game counts. Source recordings
remain unchanged. The export contains 17,469 events and 107,920 surveys across 200 games.

## Publish

GitHub Pages serves `docs/` from the `main` branch. Changes to that branch publish
automatically. The included `.nojekyll` file keeps this a plain static site.
Relative asset and data URLs also support a repository subpath.
