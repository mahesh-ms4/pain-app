import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { submitBatchSample } from './services/humeClient.js';
import {
  listForms,
  getFormDetails,
  fetchStatelessAssessmentItem,
  scoreFormResponses,
  isPediatricForm,
  PromisError,
} from './services/promisClient.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/hume/config', (req, res) => {
  const apiKey = process.env.HUME_API_KEY ?? '';
  const configId = process.env.HUME_CONFIG_ID ?? '';
  const baseUrl = process.env.HUME_BASE_URL ?? 'https://api.hume.ai/v0';

  if (!apiKey) {
    return res.status(500).json({ message: 'Hume API key is not configured on the server' });
  }

  res.json({
    apiKey,
    configId: configId || null,
    baseUrl,
  });
});

app.post('/api/hume/batch', async (req, res) => {
  try {
    const { audio, video, config } = req.body ?? {};
    if (!audio && !video) {
      return res.status(400).json({ message: 'audio or video payload required' });
    }
    const response = await submitBatchSample({ audio, video, config });
    res.json(response);
  } catch (error) {
    console.error('Failed to submit batch sample', error);
    res.status(error.statusCode || 500).json({
      message: 'Failed to submit batch sample',
      details: error.message,
    });
  }
});

app.get('/api/promis/forms', async (req, res) => {
  try {
    const { category } = req.query ?? {};
    const payload = await listForms();
    const forms = Array.isArray(payload?.Form) ? payload.Form : [];
    const filtered =
      typeof category === 'string' && category.toLowerCase() === 'pediatric'
        ? forms.filter(isPediatricForm)
        : forms;

    res.json({
      forms: filtered,
      total: filtered.length,
      category: category ?? null,
    });
  } catch (error) {
    const status = error instanceof PromisError ? error.statusCode : error.statusCode ?? 500;
    console.error('Failed to fetch PROMIS forms', error);
    res.status(status).json({
      message: 'Failed to fetch PROMIS forms',
      details: error.message,
    });
  }
});

app.get('/api/promis/forms/:oid', async (req, res) => {
  try {
    const { oid } = req.params;
    if (!oid) {
      return res.status(400).json({ message: 'OID parameter is required' });
    }
    const details = await getFormDetails(oid);
    res.json(details);
  } catch (error) {
    const status = error instanceof PromisError ? error.statusCode ?? 500 : error.statusCode ?? 500;
    console.error(`Failed to fetch PROMIS form details for ${req.params?.oid}`, error);
    res.status(status).json({
      message: 'Failed to fetch form details',
      details: error.message,
    });
  }
});

app.post('/api/promis/forms/:oid/stateless', async (req, res) => {
  try {
    const { oid } = req.params;
    const { responses } = req.body ?? {};
    if (!oid) {
      return res.status(400).json({ message: 'OID parameter is required' });
    }

    const payload = await fetchStatelessAssessmentItem(oid, responses ?? []);
    const thetaNumeric =
      typeof payload?.Theta === 'number'
        ? payload.Theta
        : payload?.Theta
        ? Number.parseFloat(payload.Theta)
        : undefined;
    if (typeof thetaNumeric === 'number' && !Number.isNaN(thetaNumeric)) {
      const tScore = Number.parseFloat((thetaNumeric * 10 + 50).toFixed(4));
      payload.tScore = tScore;
      payload.TScore = tScore;
    }
    res.json(payload);
  } catch (error) {
    const status = error instanceof PromisError ? error.statusCode ?? 500 : error.statusCode ?? 500;
    console.error(`Failed to fetch PROMIS stateless item for ${req.params?.oid}`, error);
    res.status(status).json({
      message: 'Failed to fetch next assessment item',
      details: error.message,
    });
  }
});

app.post('/api/promis/forms/:oid/score', async (req, res) => {
  try {
    const { oid } = req.params;
    const { responses } = req.body ?? {};
    if (!oid) {
      return res.status(400).json({ message: 'OID parameter is required' });
    }
    if (!Array.isArray(responses) || responses.length === 0) {
      return res.status(400).json({ message: 'Responses array is required for scoring' });
    }

    const payload = await scoreFormResponses(oid, responses);
    const thetaNumeric =
      typeof payload?.Theta === 'number'
        ? payload.Theta
        : payload?.Theta
        ? Number.parseFloat(payload.Theta)
        : undefined;
    if (typeof thetaNumeric === 'number' && !Number.isNaN(thetaNumeric)) {
      const tScore = Number.parseFloat((thetaNumeric * 10 + 50).toFixed(4));
      payload.tScore = tScore;
      payload.TScore = tScore;
    }
    res.json(payload);
  } catch (error) {
    const status = error instanceof PromisError ? error.statusCode ?? 500 : error.statusCode ?? 500;
    console.error(`Failed to score PROMIS form for ${req.params?.oid}`, error);
    res.status(status).json({
      message: 'Failed to score assessment responses',
      details: error.message,
    });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
