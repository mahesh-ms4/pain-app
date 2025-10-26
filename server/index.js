import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createStreamingToken, submitBatchSample } from './services/humeClient.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, '../public')));

app.post('/api/hume/token', async (req, res) => {
  try {
    const { metadata } = req.body ?? {};
    const token = await createStreamingToken(metadata);
    res.json({ token });
  } catch (error) {
    console.error('Failed to create Hume token', error);
    res.status(error.statusCode || 500).json({
      message: 'Failed to create streaming token',
      details: error.message,
    });
  }
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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
