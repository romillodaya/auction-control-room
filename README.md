# Auction Control Room

Local-first auction app for one auctioneer.

## Men's And Women's Sections

Use the `Men's` / `Women's` switch in the header to move between the two auctions. Each section keeps its own teams, players, current player, bids, retained players, and results.

Default setup uses the KPL 2026 registration data:

```text
Men's: 6 teams
Women's: 2 teams
Players: 52 men's registrations, 14 women's registrations
```

The source workbook exported from Numbers is kept at `data/kpl-2026-registrations.xlsx`, and the app seed data lives in `src/seed-data.mjs`. Player IDs match the registration IDs, so photos should use names like `photos/1.jpg`, `photos/13.jpg`, and `photos/66.jpg`.

CSV and Excel player imports can include both sections in one file. Add a `Gender` column with values such as `Men`, `Male`, `Women`, or `Female`; the app will place each row into the matching section. Team imports also support the same `Gender` column.

Exports from the Teams and Players screens are for the active section, so switch to `Men's` or `Women's` before exporting that section.

## Start

```bash
cd "/Users/romil/projects/auction-control-room"
node serve.mjs
```

Open:

```text
http://127.0.0.1:4173
```

## Stop

In the same terminal where the server is running, press:

```text
Ctrl+C
```

## If Port 4173 Is Busy

Start on another port:

```bash
PORT=4174 node serve.mjs
```

Then open:

```text
http://127.0.0.1:4174
```

## Test

```bash
node --test
```

## Player Photos

Each player has a simple `Player ID` such as `1`, `2`, `3`, and so on. For portable local photos, put images in the `photos/` folder using that ID as the filename:

```text
photos/1.jpg
photos/2.webp
photos/3.png
```

If the `Photo URL / Path` field is empty, the app automatically tries `photos/<Player ID>.jpg`, `.jpeg`, `.png`, and `.webp`. You can still override this per player by entering a custom relative path or URL in `Photo URL / Path`.

The local server serves files from the app folder, so this keeps working if you copy the whole `auction-control-room` folder, including `photos/`, to another laptop.

Full JSON backups can also store uploaded/base64 image data, but relative files are better for many player photos because they keep the app data small.

## Team Logos

Team logos can be uploaded from the Setup screen after a team exists, or kept as portable local files. For local files, put logos in the `logos/` folder using a slug of the team name:

```text
logos/super-kings.png
logos/team-alpha.webp
```

If a team's `Logo Path / URL` field is empty, the app tries `logos/<team-name-slug>.png`, `.jpg`, `.jpeg`, and `.webp`. Uploaded logos are saved inside the browser data, which is convenient for a few small team logos; local files are better if you want the app folder to stay portable and light.

## Owner Exports

The Backup screen has two owner-friendly exports:

```text
Export Excel      Adds a Team Rosters sheet with each team's retained and purchased players.
Export Team Cards Downloads a printable HTML report with team-logo cards and an overall roster table.
```

Open the Team Cards HTML file in a browser and use Print or Save as PDF when you want one shareable PDF for owners.

## Undo Steps

`Undo Steps` means how many recent auction actions can still be undone with the `Undo` button. These are not auction points. The app keeps this history capped so browser storage stays small during the auction.
