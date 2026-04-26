# Auction Control Room

Local-first auction app for one auctioneer.

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
