# NetEase API Simulator

A standalone utility to replay NetEase API calls currently used by this client.
It reuses local auth state from netease-auth.json, records compact snapshots, and produces an unknown audit report.

## Run

```bash
npm run api-sim
```

## Common Options

```bash
node tools/netease-api-sim/index.js --help
node tools/netease-api-sim/index.js --keyword 林俊杰 --song-id 33894312 --playlist-id 19723756
node tools/netease-api-sim/index.js --auth-file "C:\\Users\\<you>\\AppData\\Roaming\\music-player\\netease-auth.json"
```

## Output

By default, outputs are written to:

- tools/netease-api-sim/runs/<timestamp>/run-report.json
- tools/netease-api-sim/runs/<timestamp>/endpoints/*.json
- tools/netease-api-sim/runs/<timestamp>/unknown-audit.json
- tools/netease-api-sim/runs/<timestamp>/unknown-audit.md

## Safety

- Default mode is safe.
- Message APIs use invalid userIds in safe mode, so they should not send real messages.
- Response snapshots trim large payloads and data URLs to avoid storing oversized binary-like content.
