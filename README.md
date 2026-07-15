# GymPlan

A mobile-first workout companion that reads a trainer's plan from a Google
Sheet, guides you through each session exercise-by-exercise with rest timers,
and writes your weights and rep results back into the sheet — no backend, no
accounts, hosted on GitHub Pages.

## How it works

```
GitHub Pages (this repo: static HTML/CSS/JS)
        │  POST (text/plain JSON, passphrase-gated)
        ▼
Google Apps Script web app  ←→  Google Sheet (trainer's original layout)
```

The sheet keeps the trainer's original format (week blocks of
`Sets | Weight | Rep Goal | Rep Results` columns plus session headers like
`Week 1: Session 1 (60 secs rest)`). The Apps Script parses it dynamically —
add a `Week 7` block of 4 columns and it appears in the app automatically.
All values are treated as strings, so rep goals like `10-12`, `45 secs`,
`MAX` and weights like `12.5` or `red band` all work.

## Setup

### 1. Google Sheet + Apps Script

1. Import your plan xlsx into a new Google Sheet (File → Import).
2. Extensions → Apps Script → paste `apps-script/Code.gs`.
3. Project Settings → Script Properties → add `PASSPHRASE` = a secret you choose.
4. Deploy → New deployment → Web app → execute as **Me**, access **Anyone**.
   Authorize when asked, copy the `/exec` URL.

### 2. Frontend

Open the GitHub Pages URL, enter the web app URL and your passphrase once —
both stay in your browser's localStorage. Use `demo` as the URL to try the
app without a sheet.

## Privacy

The Pages site is public but contains no data and no secrets. Every API
request must carry the passphrase, which is checked against a Script Property
on the Google side; without it nothing is read or written. Your plan data,
script URL and passphrase never enter this repo.

## Development

```
node --test test/     # parser tests (needs test/fixtures/sheet_values.json,
                      # a local JSON dump of the sheet — not committed)
python3 -m http.server -d . 8080   # then open http://localhost:8080, URL "demo"
```
