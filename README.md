# Retirement Calculator

**No fluff. Just math.**

A brutally honest FIRE calculator. Tell it where you are, where you're headed, and it tells you when you can actually retire — or what it would take to get there.

**Live:** [0xwenmoon.github.io/retirement-calculator](https://0xwenmoon.github.io/retirement-calculator/)

---

## What it does

Most retirement calculators assume flat spending for life. This one doesn't.

You enter three things — your current situation, your peak spending expectations, and your income — and the model runs a realistic spending curve from today to age 90, computes your minimum nest egg, and gives you a verdict.

**Outputs:**
- Your FIRE number (minimum nest egg to retire safely)
- Your retire age, or how far off you are
- A withdrawal rate safety rating (super safe / safe barely / hairy / can't retire comfortably)
- The 1–2 levers that would actually close the gap if you're not on track
- An archetype (8 types, brutal honesty included)
- A shareable snapshot card with a pre-filled tweet

---

## The model

### Spending curve

Spending isn't flat — it ramps up in your 30s, peaks in your 40s, then tapers. The model uses this curve:

| Age range | Spending |
|-----------|----------|
| < 25 | Current spend |
| 25–35 | Ramps from current → peak |
| 35–50 | Flat at peak |
| 50–65 | Tapers toward current × 1.4 |
| 65–75 | Tapers to current × 1.2 |
| 75–90 | current × 1.2, rising to current × 1.2 + peak × 0.2 (healthcare) |

### Simulation

**Accumulation phase:** `portfolio = portfolio × (1 + growth) + (income − spend)`

**Retirement phase:** `portfolio = portfolio × (1 + growth) − spend`

The minimum nest egg is found via binary search — the smallest starting portfolio that survives to age 90 without breaching the withdrawal rate cap in any year.

### Withdrawal rate tiers

The max withdrawal rate hit during the retirement phase determines the safety rating:

| Rate | Rating |
|------|--------|
| ≤ 3% | Super safe |
| ≤ 3.5% | Safe, but barely |
| ≤ 4% | Could be hairy |
| > 4% | Can't retire comfortably |

### Verdict states

| State | Meaning |
|-------|---------|
| Green | You can retire now |
| Amber-good | On track — FIRE within your earning window |
| Amber-warn | Behind your plan — specific fixes identified |
| Red | Not earning, not on track — needs structural change |

---

## Stack

- Vanilla JS + HTML/CSS — no framework, no build step
- [Chart.js](https://www.chartjs.org/) + [chartjs-plugin-annotation](https://www.chartjs.org/chartjs-plugin-annotation/) for charts
- [Syne](https://fonts.google.com/specimen/Syne) + [DM Sans](https://fonts.google.com/specimen/DM+Sans) from Google Fonts
- Hosted on GitHub Pages

---

## Files

```
index.html   — all styles + HTML shell
app.js       — all logic, simulation, and UI rendering
```

---

## Local dev

No build step needed. Just open `index.html` in a browser.

```bash
open index.html
```

Or serve it locally:

```bash
python3 -m http.server 8080
```

---

## Deploying

The site deploys to GitHub Pages from the `main` branch root. To push updates, use the GitHub Contents API (avoids session-killing git operations):

```bash
python3 -c "
import subprocess, base64, json

def deploy(path, filepath):
    with open(filepath, 'rb') as f:
        content = base64.b64encode(f.read()).decode()
    result = subprocess.run(['gh', 'api', f'repos/0xWenMoon/retirement-calculator/contents/{path}'], capture_output=True, text=True)
    sha = json.loads(result.stdout)['sha']
    payload = json.dumps({'message': f'Update {path}', 'content': content, 'sha': sha})
    subprocess.run(['gh', 'api', '--method', 'PUT', f'repos/0xWenMoon/retirement-calculator/contents/{path}', '--input', '-'], input=payload)

deploy('index.html', 'index.html')
deploy('app.js', 'app.js')
"
```

Requires [GitHub CLI](https://cli.github.com/) authenticated.

---

Vibecoded by [@0xWenMoon](https://twitter.com/0xWenMoon)
