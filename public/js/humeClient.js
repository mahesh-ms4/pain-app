const CONFIG_ENDPOINT = '/api/hume/config';
const VIDEO_FRAME_INTERVAL_MS = 1500;
const BATCH_INTERVAL_MS = 5000;

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      try {
        const result = reader.result;
        if (typeof result !== 'string') return reject(new Error('Unexpected reader result type'));
        const [, base64] = result.split(',');
        resolve(base64 ?? '');
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

function buildWebSocketUrl({ baseUrl, apiKey, configId }) {
  const normalizedBase = (baseUrl ?? 'https://api.hume.ai/v0').replace(/\/+$/, '');
  const protocolReplaced = normalizedBase.replace(/^http(s?):\/\//, (_, tls) => (tls === 's' ? 'wss://' : 'ws://'));
  const wsBase = protocolReplaced.startsWith('ws') ? protocolReplaced : `wss://${protocolReplaced}`;
  const params = new URLSearchParams({ apikey: apiKey });
  if (configId) {
    params.set('config_id', configId);
  }
  return `${wsBase}/stream/models?${params.toString()}`;
}

export class HumeMonitor {
  constructor({ previewEl, streamOutputEl, batchOutputEl, onStatusChange } = {}) {
    this.previewEl = previewEl;
    this.streamOutputEl = streamOutputEl;
    this.batchOutputEl = batchOutputEl;
    this.onStatusChange = onStatusChange;

    this.mediaStream = null;
    this.videoCanvas = null;
    this.videoTimer = null;
    this.batchRecorder = null;
    this.serverReady = true;
    this.socket = null;
    this.configPromise = null;
  }

  async enableMedia() {
    if (this.mediaStream) {
      return this.mediaStream;
    }

    this.mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (this.previewEl) {
      this.previewEl.srcObject = this.mediaStream;
    }
    this.updateStatus('Camera and microphone active.');
    return this.mediaStream;
  }

  async startMonitoring(metadata) {
    await this.enableMedia();

    const config = await this.loadConfig();
    await this.openSocket(config);
    this.startVideoStreaming(metadata);
    this.startBatchSnapshots(metadata);

    this.updateStatus('Monitoring enabled via Hume Expression Measurement (video only).');
  }

  async stopMonitoring() {
    if (this.batchRecorder && this.batchRecorder.state !== 'inactive') {
      this.batchRecorder.stop();
    }
    this.batchRecorder = null;

    if (this.videoTimer) {
      clearInterval(this.videoTimer);
      this.videoTimer = null;
    }
    this.videoCanvas = null;

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
    this.socket = null;
    this.serverReady = true;

    this.updateStatus('Monitoring stopped.');
  }

  async disableMedia() {
    await this.stopMonitoring();
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    if (this.previewEl) {
      this.previewEl.srcObject = null;
    }
    this.mediaStream = null;
    this.updateStatus('Camera and microphone released.');
  }

  async loadConfig() {
    if (!this.configPromise) {
      this.configPromise = fetch(CONFIG_ENDPOINT)
        .then(async (res) => {
          if (!res.ok) {
            const payload = await res.json().catch(() => ({}));
            const message = payload.message ?? 'Failed to load Hume configuration from server';
            throw new Error(message);
          }
          return res.json();
        })
        .catch((error) => {
          this.configPromise = null;
          throw error;
        });
    }
    return this.configPromise;
  }

  async openSocket(config) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }

    const wsUrl = buildWebSocketUrl(config);
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      let settled = false;

      socket.addEventListener('open', () => {
        settled = true;
        this.socket = socket;
        this.serverReady = true;
        this.updateStatus('Connected to Hume streaming endpoint.');
        resolve();
      });

      socket.addEventListener('message', (event) => this.handleSocketMessage(event));

      socket.addEventListener('close', (event) => {
        this.socket = null;
        this.serverReady = true;
        if (!settled) {
          settled = true;
          reject(new Error(`Streaming socket closed before connection was established (code ${event.code})`));
        } else {
          this.updateStatus('Streaming socket closed.');
        }
      });

      socket.addEventListener('error', (event) => {
        if (!settled) {
          settled = true;
          reject(new Error('Failed to establish connection to Hume streaming endpoint'));
        } else {
          this.updateStatus(`Streaming error: ${event.message ?? 'unknown error'}`);
        }
      });
    });
  }

  startVideoStreaming(metadata) {
    if (!this.mediaStream) return;

    if (!this.previewEl) {
      console.warn('No preview element configured; video streaming disabled.');
      return;
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) {
      console.warn('Unable to create canvas context; video streaming disabled.');
      return;
    }

    this.videoCanvas = canvas;

    const captureFrame = async () => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      const video = this.previewEl;
      if (!video?.videoWidth || !video.videoHeight) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      await new Promise((resolve, reject) => {
        canvas.toBlob(
          async (blob) => {
            try {
              if (!blob) return resolve();
              const base64 = await blobToBase64(blob);
              const payload = JSON.stringify({
                data: base64,
                models: {
                  face: {},
                },
              });
              if (!this.serverReady) return resolve();
              this.serverReady = false;
              this.socket.send(payload);
            } catch (error) {
              console.error('Failed to encode video frame', error);
            } finally {
              resolve();
            }
          },
          'image/jpeg',
          0.8
        );
      });
    };

    this.videoTimer = setInterval(captureFrame, VIDEO_FRAME_INTERVAL_MS);
  }

  startBatchSnapshots(metadata) {
    if (this.batchRecorder || !this.mediaStream) return;
    if (typeof MediaRecorder === 'undefined') {
      this.updateStatus('MediaRecorder API is not supported in this browser.');
      return;
    }

    this.batchRecorder = new MediaRecorder(this.mediaStream, {
      mimeType: 'video/webm;codecs=vp8,opus',
      videoBitsPerSecond: 500_000,
      audioBitsPerSecond: 64_000,
    });

    this.batchRecorder.addEventListener('dataavailable', async (event) => {
      if (!event.data || !event.data.size) return;
      try {
        const base64 = await blobToBase64(event.data);
        const response = await fetch('/api/hume/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            video: base64,
            config: {
              metadata,
              models: {
                face: {},
              },
            },
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.message ?? 'Batch submission failed');
        }

        const data = await response.json();
        this.renderBatchResult(data);
      } catch (error) {
        this.updateStatus(`Batch error: ${error.message}`);
      }
    });

    this.batchRecorder.start(BATCH_INTERVAL_MS);
  }

  handleSocketMessage(event) {
    try {
      const payload = JSON.parse(event.data);
      if (payload.error) {
        this.updateStatus(`Streaming error: ${payload.error}`);
        this.serverReady = true;
        return;
      }

      this.renderStreamEvent(payload);
    } catch (error) {
      console.error('Failed to parse streaming message', error);
    } finally {
      this.serverReady = true;
    }
  }

  renderStreamEvent(event) {
    if (!this.streamOutputEl) return;

    const details = {
      timestamp: new Date().toISOString(),
      faceTopEmotions: this.extractTopEmotions(event.face),
      warnings: this.collectWarnings(event),
    };

    this.streamOutputEl.textContent = JSON.stringify(details, null, 2);
  }

  renderBatchResult(result) {
    if (!this.batchOutputEl) return;
    const payload = {
      id: result?.job_id ?? 'unknown',
      submittedAt: new Date().toISOString(),
      details: result,
    };
    this.batchOutputEl.textContent = JSON.stringify(payload, null, 2);
  }

  updateStatus(message) {
    this.onStatusChange?.(message);
  }

  extractTopEmotions(modelResponse) {
    const predictions = modelResponse?.predictions;
    if (!Array.isArray(predictions) || predictions.length === 0) return [];
    const primary = predictions[0];
    const emotions = primary?.emotions;
    if (!Array.isArray(emotions)) return [];
    return emotions
      .filter((item) => item?.name && typeof item.score === 'number')
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((item) => ({ name: item.name, score: Number(item.score).toFixed(3) }));
  }

  collectWarnings(event) {
    const warnings = [];
    if (event?.face?.warning) warnings.push(event.face.warning);
    return warnings;
  }
}
