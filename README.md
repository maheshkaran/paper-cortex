# paper-cortex

Always-on background agent that:

- watches for new PDFs in `~/Google Drive/My Drive/Saved from Chrome/`
- files them into your library at `~/Google Drive/My Drive/Papers/<Topic_Folder>/<paper_slug>.pdf`
- updates your Obsidian vault mind map at `~/MIT:WHOI/Research/Mind_Map/` (markdown + wiki links)
- fills new concept notes (title-only) with mathematical preliminaries
- annotates new top-level bullets in `~/MIT:WHOI/Research/Idea Log.md` with related papers/concepts
- every 10 days (configurable) quarantines missing-PDF paper notes and removes dead `[[paper_slug]]` links across `Mind_Map/`

## Setup

```bash
cd "$HOME/paper-cortex"
cp .env.example .env
npm install
```

Requirements:
- `pdftotext` (Poppler)
- `pdfinfo` (Poppler)

## Run

Dev (watch):
```bash
npm run dev
```

Build + run:
```bash
npm run build
node dist/main.js
```

## Install as macOS background service (launchd)

```bash
npm run install:launchd
# logs: ~/Library/Logs/paper-cortex.log
```

Note: `launchd` does not load your shell profile, so `node` installed via Homebrew or `nvm` may not be on `PATH`. The install script uses `scripts/launchd-run.sh` to locate `node` (common Homebrew paths + `nvm`).

Uninstall:
```bash
npm run uninstall:launchd
```
