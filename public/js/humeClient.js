const STREAM_URL = 'wss://api.hume.ai/v0/streaming/assistant';

async function fetchStreamingToken(metadata) {
  const response = await fetch('/api/hume/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metadata }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message ?? 'Unable to request streaming token');
  }

  const { token } = await response.json();
  if (!token) {
    throw new Error('Token missing from server response');
  }
  return token;
}

function encodeBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export class HumeMonitor {
  constructor({ previewEl, streamOutputEl, batchOutputEl, onStatusChange } = {}) {
    this.previewEl = previewEl;
    this.streamOutputEl = streamOutputEl;
    this.batchOutputEl = batchOutputEl;
    this.onStatusChange = onStatusChange;
    this.mediaStream = null;
    this.mediaRecorder = null;
    this.streamingClient = null;
    this.batchInterval = null;
  }

  async enableMedia() {
    if (this.mediaStream) return this.mediaStream;
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (this.previewEl) {
      this.previewEl.srcObject = this.mediaStream;
    }
    this.updateStatus('Camera and microphone active.');
    return this.mediaStream;
  }

  async startMonitoring(metadata) {
    await this.enableMedia();
    await this.startStreaming(metadata);
    this.startBatchSnapshots(metadata);
    this.updateStatus('Monitoring enabled.');
  }

  async startStreaming(metadata) {
    const token = await fetchStreamingToken(metadata);
    this.streamingClient = new HumeStreamingClient({
      streamUrl: STREAM_URL,
      token,
      mediaStream: this.mediaStream,
      onEvent: (event) => this.renderStreamEvent(event),
      onError: (error) => this.updateStatus(`Stream error: ${error.message}`),
    });
    await this.streamingClient.start();
  }

  startBatchSnapshots(metadata) {
    if (this.batchInterval) return;
    if (typeof MediaRecorder === 'undefined') {
      this.updateStatus('MediaRecorder API is not supported in this browser.');
      return;
    }
    this.mediaRecorder = new MediaRecorder(this.mediaStream, {
      mimeType: 'video/webm;codecs=vp8,opus',
      videoBitsPerSecond: 500_000,
      audioBitsPerSecond: 64_000,
    });

    this.mediaRecorder.addEventListener('dataavailable', async (event) => {
      if (!event.data || !event.data.size) return;
      try {
        const base64 = await encodeBlob(event.data);
        const response = await fetch('/api/hume/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audio: base64,
            video: base64,
            config: {
              metadata,
              models: {
                facial: {},
                prosody: {},
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

    this.mediaRecorder.start(5000);
    this.batchInterval = true;
  }

  async stopMonitoring() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.mediaRecorder = null;
    if (this.streamingClient) {
      await this.streamingClient.stop();
      this.streamingClient = null;
    }
    this.batchInterval = null;
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

  renderStreamEvent(event) {
    if (!this.streamOutputEl) return;
    this.streamOutputEl.textContent = JSON.stringify(event, null, 2);
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
}

class HumeStreamingClient {
  constructor({ streamUrl, token, mediaStream, onEvent, onError }) {
    this.streamUrl = streamUrl;
    this.token = token;
    this.mediaStream = mediaStream;
    this.onEvent = onEvent;
    this.onError = onError;
    this.peerConnection = null;
    this.webSocket = null;
  }

  async start() {
    this.peerConnection = new RTCPeerConnection();
    this.mediaStream.getTracks().forEach((track) => this.peerConnection.addTrack(track, this.mediaStream));

    this.peerConnection.ontrack = (event) => {
      console.debug('Remote track received from Hume', event.streams);
    };

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.webSocket?.readyState === WebSocket.OPEN) {
        this.webSocket.send(
          JSON.stringify({
            type: 'ice-candidate',
            candidate: event.candidate,
          })
        );
      }
    };

    await this.openSocket();
    const offer = await this.peerConnection.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await this.peerConnection.setLocalDescription(offer);

    this.sendMessage({ type: 'offer', offer });
  }

  async openSocket() {
    this.webSocket = new WebSocket(`${this.streamUrl}?token=${encodeURIComponent(this.token)}`);
    this.webSocket.onmessage = async (message) => {
      try {
        const payload = JSON.parse(message.data);
        await this.handleSocketMessage(payload);
      } catch (error) {
        console.error('Failed to parse Hume message', error);
      }
    };

    this.webSocket.onerror = (event) => {
      console.error('Hume socket error', event);
      this.onError?.(new Error('Streaming connection error'));
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.webSocket.readyState !== WebSocket.OPEN) {
          reject(new Error('Hume streaming socket timeout'));
        }
      }, 5000);

      this.webSocket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };

      this.webSocket.onclose = () => {
        clearTimeout(timer);
        this.onError?.(new Error('Streaming connection closed'));
      };
    });
  }

  async handleSocketMessage(payload) {
    switch (payload.type) {
      case 'answer':
        await this.peerConnection.setRemoteDescription(payload.answer);
        break;
      case 'ice-candidate':
        if (payload.candidate) {
          await this.peerConnection.addIceCandidate(payload.candidate);
        }
        break;
      case 'event':
        this.onEvent?.(payload.data);
        break;
      default:
        console.warn('Unhandled Hume payload', payload);
    }
  }

  sendMessage(message) {
    if (this.webSocket?.readyState === WebSocket.OPEN) {
      this.webSocket.send(JSON.stringify(message));
    }
  }

  async stop() {
    this.peerConnection?.getSenders().forEach((sender) => {
      if (sender.track) {
        sender.track.stop();
      }
    });
    this.peerConnection?.close();
    this.peerConnection = null;
    this.webSocket?.close();
    this.webSocket = null;
  }
}
