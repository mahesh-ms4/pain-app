import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables before accessing process.env
dotenv.config();

const HUME_API_KEY = process.env.HUME_API_KEY;
const HUME_SECRET_KEY = process.env.HUME_SECRET_KEY;
const HUME_BASE_URL = process.env.HUME_BASE_URL ?? 'https://api.hume.ai/v0';
const BATCH_JOB_PATH = process.env.HUME_BATCH_JOB_PATH ?? '/batch/jobs';

class HttpError extends Error {
  constructor(message, statusCode, payload) {
    super(message);
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

function ensureCredentials() {
  if (!HUME_API_KEY || !HUME_SECRET_KEY) {
    throw new HttpError('Hume API credentials are not configured', 500);
  }
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Hume-Api-Key': HUME_API_KEY,
    'X-Hume-Api-Secret': HUME_SECRET_KEY,
  };
}

export async function submitBatchSample({ audio, video, config }) {
  ensureCredentials();
  const body = {
    models: config?.models ?? { face: {}, prosody: {} },
    data: {},
  };

  if (audio) {
    body.data.audio = [{ value: audio }];
  }

  if (video) {
    body.data.video = [{ value: video }];
  }

  if (config?.metadata) {
    body.metadata = config.metadata;
  }

  const response = await fetch(`${HUME_BASE_URL}${BATCH_JOB_PATH}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await safeJson(response);
    throw new HttpError('Hume batch submission failed', response.status, payload);
  }

  return response.json();
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return { message: response.statusText };
  }
}
