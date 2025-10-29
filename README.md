# Emotion-Aware Endless Runner

This project hosts a lightweight canvas-based endless runner game while streaming audio and video to the Hume AI APIs for emotion detection. Players can opt in to monitoring, and the app will continue to render the game loop while the camera and microphone run in the background.

## Features

- **Canvas-based endless runner** with simple jump controls.
- **Live Hume AI streaming** by pushing audio and video frames to the Expression Measurement WebSocket API.
- **Periodic batch snapshots** that submit audio/video clips to the Hume batch API for redundancy.
- **Secure credential handling** using environment variables and a lightweight backend proxy for configuration.
- **Opt-in monitoring controls** with live status updates and payload inspectors for debugging.

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and populate it with your Hume credentials. You can also override optional settings that point at self-hosted gateways or sandboxes.

```bash
cp .env.example .env
```

| Variable | Description |
| --- | --- |
| `HUME_API_KEY` | Long-lived API key from the Hume dashboard. |
| `HUME_SECRET_KEY` | Secret key paired with the API key. |
| `HUME_BASE_URL` | Optional. Defaults to `https://api.hume.ai/v0`. |
| `HUME_CONFIG_ID` | Optional. ID of a saved Expression Measurement configuration to apply to streaming sessions. |
| `HUME_BATCH_JOB_PATH` | Optional. Batch job submission path. Defaults to `/batch/jobs`. |

### 3. Run the development server

```bash
npm start
```

Navigate to `http://localhost:3000` and grant the browser access to your camera and microphone when prompted.

#### Switching themes

The Arizona Anesthesia look loads by default. To toggle to a neutral theme without UA branding at runtime, open the browser console and call:

```js
useNeutralTheme(); // swaps to styles-neutral.css
useUniversityTheme(); // restores the UA theme
```

## Architecture

```
┌──────────────────────┐        ┌────────────────────────────┐
│  Browser Game (UI)   │        │        Express Server      │
│                      │        │                            │
│  • Canvas runner     │◄──────►│  Static asset hosting      │
│  • HumeMonitor       │  fetch │  Config endpoint           │
│  • MediaRecorder     │        │  Batch submission proxy    │
└─────────┬────────────┘        └──────────────┬─────────────┘
          │                                     │
          │ WebSocket (Expression Measurement)   │ HTTPS
          ▼                                     ▼
   Hume Streaming API                   Hume Batch API
```

### Frontend

- `public/js/game.js` keeps the endless runner responsive with requestAnimationFrame.
- `public/js/humeClient.js` wraps media capture, streams audio/video frames over the Hume WebSocket API, and handles batch uploads.
- `public/js/main.js` coordinates UI events, toggling monitoring, and reporting status.

### Backend

- `server/index.js` exposes `/api/hume/config` and `/api/hume/batch` endpoints and serves the static game client.
- `server/services/humeClient.js` reads credentials, calls Hume APIs, and normalizes errors.

## Privacy & Compliance

- Show consent dialogs or update `index.html` to suit your disclosure requirements.
- Persist monitoring results securely and purge data according to policy.
- Serve over HTTPS in production (required for `getUserMedia`).

## Testing Notes

Manual testing requires:

1. Running `npm start`.
2. Opening the app in a Chromium-based browser.
3. Starting the game and enabling monitoring.
4. Verifying that stream events arrive and batch submissions succeed in the console.

Automated tests are not included, but the architecture isolates the Hume API integration behind `HumeMonitor` and `server/services/humeClient.js` for future unit testing or mocks.
