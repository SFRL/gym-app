# Writing a workout plan

The app has no plan of its own — it reads whatever is in your Google Sheet every
time it loads. So updating your training plan means editing the sheet, and
**nothing needs to be redeployed**: no new script, no new URL, no new passphrase.
Change the sheet, reload the app, done.

This page describes the layout the sheet has to follow, and how to publish a new
plan into it.

---

## The short version

| I want to… | Do this |
|---|---|
| Change a weight, goal or exercise name | Edit the cell in the sheet, reload the app |
| Add or remove an exercise | Insert/delete a row inside the session's exercise block |
| Add more weeks | Nothing — the app appends a new week when you finish the last one |
| Redo a week | Clear that week's **Rep Results** cells |
| Load a completely new plan | Import it as a new tab **and drag that tab to the far left** (see [Publishing a new plan](#publishing-a-new-plan)) |

Reload = pull down to refresh in the browser, or close and reopen the app.

---

## How the sheet is laid out

The app reads the trainer's own format, so the sheet stays something you can
share back with the gym. One session looks like this:

```
        A                 B                    C      D        E          F            G      H  ...
 5 │                                       │ Week 1: Session 1 (60 secs rest)   │ Week 2: Session 1 (60 secs rest) │
 6 │ Straight sets     │ Exercise          │ Sets │ Weight │ Rep Goal │ Rep Results │ Sets │ ...
 7 │ Lower quad focus  │ Pistol squat      │  3   │        │  10-12   │             │  3   │ ...
 8 │ Back              │ Back extensions   │  3   │        │  10-12   │             │  3   │ ...
 9 │ Shoulders         │ Kneeling press    │  3   │        │   6-8    │             │  3   │ ...
```

Four things make that work:

1. **A session header row** (row 5 above) holding one cell per week:
   `Week 1: Session 1 (60 secs rest)`.
2. **A field header row** (row 6) whose **column B says `Exercise`**. This row
   must be within three rows below the session header row.
3. **Exercise rows** (rows 7+) directly below it, with the exercise name in
   **column B**.
4. **Week blocks of exactly four columns** — `Sets`, `Weight`, `Rep Goal`,
   `Rep Results` — the first starting in the same column as its week header,
   each week sitting immediately to the right of the previous one.

Repeat the whole pattern further down the sheet for session 2, session 3, and so
on. Rows above, below and between sessions (titles, notes, warm-up text) are
ignored, so keep whatever your trainer writes there.

### Session header cells

The text must contain `Week <number>` and `Session <number>` — the colon and the
exact spacing don't matter, and anything else in the cell is fine:

```
Week 1: Session 1 (60 secs rest)          ✅
Week 3 Session 2 (rest 10 secs, 1.5mins)  ✅
Week 7: Session 1 — deload (45 secs)      ✅
Session 1, Week 1                         ❌  wrong order, won't be found
```

Rules that matter:

- **All weeks of one session live on one row**, and that row belongs to that
  session alone. Don't put session 1 and session 2 headers on the same row.
- **The session number decides the order** in the app, and its name
  (`Session 1`, `Session 2`, …) comes from that number.
- **The rest times go in the parentheses** — see [Rest times](#rest-times).

### Straight sets vs. circuits

Column A of the *field header row* (the one with `Exercise` in column B) is the
session's label, and it decides how the session is run:

| Label in column A | Behaviour |
|---|---|
| `Straight sets` (or anything without "circuit") | All sets of exercise 1, then all sets of exercise 2, … |
| `Circuit x 3 rounds` | One set of every exercise, then round 2, then round 3 |

For a circuit, the round count comes from `x <number>` in the label (defaulting
to 3 if it's missing). Write it as `x 3` — and avoid other "x + number" text in
that cell, which would be picked up instead.

### Exercise rows

- **Column B — the exercise name.** Required. Whatever you type is what the app
  shows.
- **Column A — the muscle group or label.** Optional, shown as a small tag above
  the exercise name (`Lower quad focus`, `Core`, `Back`).
- **No blank rows inside a session.** The exercise list ends at the first row
  whose column B is empty, so a gap will silently hide everything below it.
- Adding or deleting rows is safe — nothing refers to fixed row numbers, the app
  re-reads positions each time it loads.
- Put `per side` or `each side` in the name (e.g. `Single leg RDL (per side)`)
  and the app will handle it as a two-sided exercise — see [Per-side
  exercises](#per-side-exercises).

### Sets, Weight, Rep Goal, Rep Results

| Column | Who writes it | Notes |
|---|---|---|
| **Sets** | You / your trainer | A plain number. Blank or unreadable counts as 3. Circuits ignore it — their rounds come from the label. |
| **Weight** | The app (and you) | Free text, so `12.5`, `20kg`, `red band` and `bodyweight` all work. Carried over from the previous week when this week's cell is empty. |
| **Rep Goal** | You / your trainer | The target — see the table below. |
| **Rep Results** | The app | What you actually did, one value per set: `12,11,9`. Also how the app knows the week is finished, so leave the column empty in a fresh plan. |

### Rep goal formats

| You write | The app does |
|---|---|
| `10-12` | Reps. Input prefills with the top of the range (12). |
| `8` | Reps, prefilled with 8. |
| `MAX` (or any text) | Reps, nothing prefilled — you type what you managed. |
| `45 secs` · `45 sec` · `45s` | **Timed set**: "Start set" → Ready · Set · Go → 45-second countdown. |
| `2 mins` · `1.5 min` · `2m` | Timed set of 120 / 90 / 120 seconds. |
| `45-60 secs` | Timed set using the lower end (45s). Edit the number before starting to use any other value. |

Anything with a number followed by `s`, `sec`, `secs`, `m`, `min` or `mins` is
treated as a timed set; everything else is rep-based.

> **⚠️ Google Sheets turns `10-12` into a date.** Before typing rep ranges,
> select the Rep Goal columns and set **Format → Number → Plain text**, or type
> a leading apostrophe: `'10-12`. If a cell shows `10/12/2026` the app will show
> that instead of your range.

### Per-side exercises

If the name contains `per side` or `each side`:

- **With a timed goal**, the countdown runs twice — "Side 1", then a **Next
  side** button, then "Side 2", each with its own Ready · Set · Go.
- **With a rep goal**, it's a normal set; the name reminds you to do both sides.

### Rest times

Rest lives in the parentheses of each session header cell, so it can differ per
week — exactly how the trainer writes progressions.

| Session type | Write | Meaning |
|---|---|---|
| Straight sets | `(60 secs rest)` | 60s between sets |
| Circuit | `(rest 15 secs, 2 mins)` | 15s between exercises, 2 min between rounds |

- Seconds or minutes both work: `45 secs`, `1.5 mins`, `90 secs`.
- A range like `(rest 5-10 secs, 1.5 mins)` uses the **upper** bound (10s).
- Missing or unreadable rest falls back to 60s (and 2 min between rounds).
- **Editing rest in the app writes back here**, rewriting just the parentheses,
  so the cell keeps your trainer's wording.

---

## How the app picks which week you're on

There is no week selector: each session independently opens at **its first week
whose Rep Results aren't all filled in**.

- Finish every exercise of Week 1 → next time that session opens at Week 2.
- Quit halfway → the card says "Week 2 · continue" and you pick up where the
  sheet left off.
- Sessions advance independently, so session 1 can be on week 3 while session 2
  is still on week 1.
- Finish the last week in the sheet and the app **adds a new week column block
  automatically**, copying the previous week's header, rest times, sets and rep
  goals, with Weight and Rep Results left blank.

That gives you two handy manual controls:

- **Repeat a week** — clear its Rep Results cells.
- **Skip a week** — put anything (`-`) in every Rep Results cell of that week.

Weights and reps always prefill from the previous week when the current week is
blank, which is how "match or beat last week" works.

---

## Publishing a new plan

The Apps Script is bound to **one spreadsheet file** and scans its tabs
left to right, using **the first tab that contains a valid `Week N: Session M`
header**. Everything below follows from that.

### Option A — new plan from the gym (recommended)

1. Open your existing **Sebastian reprogramme** spreadsheet (the one the app
   already uses — don't create a new file).
2. **File → Import → Upload**, choose the new `.xlsx`, and pick
   **Insert new sheet(s)**.
3. Google puts the new tab at the *end*. **Drag it to the far left**, before the
   old plan's tab — otherwise the old plan keeps winning and nothing changes.
4. Check it against [the checklist](#checklist-before-you-train) below, fixing
   the header text and number formats if the new file words things differently.
5. Reload the app. All sessions start at Week 1 again; the old plan stays in the
   file as history.

### Option B — edit the plan you already have

Change exercise names, goals, sets or rest directly in the current tab, then
reload the app. Best done between workouts: the app maps rows when a session
loads, so restructuring mid-session could write a result into the wrong row.

### Option C — writing a plan from scratch

Start from a copy of the current tab (right-click the tab → Duplicate), clear
the Rep Results and Weight columns, and rewrite the exercises. Copying keeps the
header rows, column blocks and formatting that the parser depends on — much
easier than rebuilding the grid by hand.

### What if I want a brand-new spreadsheet file?

Then the script has to be set up again for that file: Extensions → Apps Script →
paste `apps-script/Code.gs`, add the `PASSPHRASE` script property, deploy as a
web app, and log in to the app with the new `/exec` URL. Staying in one
spreadsheet avoids all of that.

---

## Checklist before you train

- [ ] One header row per session containing `Week N: Session M (… rest …)` for every week
- [ ] A row with `Exercise` in column B, at most three rows under each session header
- [ ] Session type in column A of that row (`Straight sets` / `Circuit x 3 rounds`)
- [ ] Exercise names in column B, no blank rows inside a session
- [ ] Week blocks four columns wide: Sets · Weight · Rep Goal · Rep Results
- [ ] Rep ranges show as `10-12`, not as dates
- [ ] Rep Results empty for weeks you haven't done
- [ ] New tab dragged to the leftmost position (if you imported one)
- [ ] Reload the app — every session should show "Week 1" and the right exercises

If a session doesn't show up at all, it is almost always the field header row:
column B has to say exactly `Exercise`, within three rows of the session header.

---

## Trying changes safely

- Open the app with `demo` as the URL to play with a synthetic plan that never
  touches your sheet (log out first, or use a private window).
- Version history in Google Sheets (**File → Version history**) undoes any edit,
  including ones the app made.
- The app never deletes rows or columns — it only writes into Weight, Rep
  Results and the rest text in the session headers.
