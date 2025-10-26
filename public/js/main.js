import { RunnerGame } from './game.js';
import { HumeMonitor } from './humeClient.js';

const canvas = document.getElementById('game-canvas');
const startBtn = document.getElementById('start-game');
const toggleMonitoringBtn = document.getElementById('toggle-monitoring');
const stopMonitoringBtn = document.getElementById('stop-monitoring');
const hudScore = document.getElementById('hud-score');
const hudStatus = document.getElementById('hud-status');
const streamOutput = document.getElementById('stream-output');
const batchOutput = document.getElementById('batch-output');
const preview = document.getElementById('camera-preview');

const game = new RunnerGame(canvas, {
  onScore: (score) => {
    hudScore.textContent = `Score: ${score}`;
  },
});

const humeMonitor = new HumeMonitor({
  previewEl: preview,
  streamOutputEl: streamOutput,
  batchOutputEl: batchOutput,
  onStatusChange: (status) => {
    hudStatus.textContent = `Status: ${status}`;
  },
});

startBtn.addEventListener('click', () => {
  hudStatus.textContent = 'Status: Running';
  game.start();
});

let monitoringEnabled = false;

toggleMonitoringBtn.addEventListener('click', async () => {
  if (monitoringEnabled) {
    await stopMonitoring();
    return;
  }

  try {
    await humeMonitor.startMonitoring({ source: 'endless-runner-demo' });
    monitoringEnabled = true;
    toggleMonitoringBtn.textContent = 'Monitoring Active';
    toggleMonitoringBtn.disabled = true;
    stopMonitoringBtn.disabled = false;
  } catch (error) {
    console.error(error);
    hudStatus.textContent = `Status: ${error.message}`;
  }
});

stopMonitoringBtn.addEventListener('click', async () => {
  await stopMonitoring();
});

async function stopMonitoring() {
  try {
    await humeMonitor.stopMonitoring();
  } finally {
    monitoringEnabled = false;
    toggleMonitoringBtn.textContent = 'Enable Monitoring';
    toggleMonitoringBtn.disabled = false;
    stopMonitoringBtn.disabled = true;
  }
}

window.addEventListener('beforeunload', () => {
  humeMonitor.disableMedia();
});

async function init() {
  try {
    await humeMonitor.enableMedia();
    hudStatus.textContent = 'Status: Ready';
  } catch (error) {
    console.error('Media permission denied', error);
    hudStatus.textContent = 'Status: Permissions required to enable monitoring';
  }
}

init();
