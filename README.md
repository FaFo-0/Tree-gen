# INPUT / OUTPUT — branch · root · rhizome generator

A 100% algorithmic (no-AI, no-dataset) generator of bare tree branches, root systems,
rhizomes and radial mandalas. Runs entirely in the browser — pure HTML/JS/Canvas,
no backend, no build step. Deploys to Vercel as a static site.

Made for the **INPUT/OUTPUT** installation (a 140×90 cm mural of 72 QR codes tied
together by a single radiating branch image), but it's a general creative tool.

## Use it
Just open `index.html`, or serve the folder:

```bash
python3 -m http.server 5178      # then open http://localhost:5178
```

## Features
- **Recursive branch engine** — bushy (dense Y-forks) or tree (monopodial, bold-limb hierarchy).
- **Movable center** — click the canvas to place the convergence point (corners/edges too).
- **Multiple centers** — shift-click to add convergence points → forests / rhizome networks.
- **Draggable main-limb handles** — drag the dots to aim each main limb.
- **Wind / gravity** — directional bias for windswept trees or hanging roots.
- **Breeze** — live wind animation (branches sway).
- **Radial symmetry + mirror** — kaleidoscopic mandalas.
- **Buds at tips** — dots at branch ends for a blossom/node look.
- **Style presets** — Root system, Dense tree, Rhizome, Windswept, Mandala, Neuron.
- **~29 live parameters**, each with a 🔒 lock.
- **Randomize** (skips locked) and **Mutate** (nudge unlocked params to explore nearby variations).
- **Seed gallery** — 12-thumbnail contact sheet; click one to load it.
- **Undo / redo** history.
- **Aspect ratio** — 140:90 (mural), square, portraits, wide, tall.
- **Presets** — save/load to a `.json` file or to browser slots (localStorage).
- **Export PNG** — huge resolution (default 8400×5400 = 150 dpi at 140×90 cm), white or transparent.
- **Export video** — seed-sweep or growth animation → `.webm`, optional per-frame randomization; live in-browser preview.

Everything runs locally in your browser — nothing is uploaded.

## Keyboard shortcuts
`R` randomize · `M` mutate · `S` random seed · `C` reset center · `G` gallery ·
`Ctrl+Z` undo · `Ctrl+Shift+Z` redo · `H` / `?` help · `Esc` close overlays.
Click = move center · Shift-click = add center · drag a dot = aim a limb.

## Deploy to Vercel
1. Push this repo to GitHub (already done if you used the provided setup).
2. On [vercel.com](https://vercel.com) → **Add New → Project** → import this repo.
3. Framework preset: **Other** (it's a static site). No build command, output dir = root.
4. Deploy. Done — the static `index.html` is served.

## Files
- `index.html`, `app.js` — the web app (this is the tool).
- `branchgen.py`, `app.py` — the original Python/Pillow version (local-only, kept for reference; not used by the web app).

100% algorithmic. No AI, no datasets, no generative-AI services.
