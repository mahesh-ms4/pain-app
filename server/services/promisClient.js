import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const PROMIS_BASE_URL = (process.env.PROMIS_BASE_URL ?? 'https://www.assessmentcenter.net/ac_api').replace(/\/$/, '');
const PROMIS_API_VERSION = (process.env.PROMIS_API_VERSION ?? '2014-01').replace(/^\//, '');
const PROMIS_REGISTRATION =
  process.env.PROMIS_REGISTRATION ?? '86EBE839-C808-4CD9-B308-8EC79FAB2B76';
const PROMIS_TOKEN = process.env.PROMIS_TOKEN ?? '2460B692-2B83-463B-88B1-8F353D6698DD';
const PEDIATRIC_PAIN_INTERFERENCE_SHORT_FORM_OIDS = new Set([
  '154D0273-C3F6-4BCE-8885-3194D4CC4596',
]);

export class PromisError extends Error {
  constructor(message, statusCode, payload) {
    super(message);
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

function ensureCredentials() {
  if (!PROMIS_REGISTRATION || !PROMIS_TOKEN) {
    throw new PromisError('PROMIS API credentials are not configured', 500);
  }
}

function buildUrl(path) {
  const trimmed = path.replace(/^\//, '');
  return `${PROMIS_BASE_URL}/${PROMIS_API_VERSION}/${trimmed}`;
}

function authHeader() {
  const encoded = Buffer.from(`${PROMIS_REGISTRATION}:${PROMIS_TOKEN}`, 'utf8').toString('base64');
  return `Basic ${encoded}`;
}

async function request(path, { body, headers, method } = {}) {
  ensureCredentials();
  const requestHeaders = {
    Authorization: authHeader(),
    Accept: 'application/json',
    ...headers,
  };

  if (!('Content-Type' in requestHeaders)) {
    requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
  }

  const response = await fetch(buildUrl(path), {
    method: method ?? 'POST',
    headers: requestHeaders,
    body: typeof body === 'undefined' ? '' : body,
  });

  const data = await safeJson(response);
  if (!response.ok) {
    throw new PromisError('PROMIS API request failed', response.status, data);
  }

  return data;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return { message: response.statusText };
  }
}

export async function listForms() {
  return request('Forms/.json');
}

export async function getFormDetails(formOid) {
  if (!formOid) {
    throw new PromisError('Form OID is required', 400);
  }
  return request(`Forms/${formOid}.json`);
}

export async function fetchStatelessAssessmentItem(formOid, responses = []) {
  if (!formOid) {
    throw new PromisError('Form OID is required', 400);
  }

  const hasResponses = Array.isArray(responses) && responses.length > 0;
  const path =
    hasResponses
      ? `StatelessParticipants/${formOid}.json?BodyParam=true`
      : `StatelessParticipants/${formOid}.json`;

  const body = hasResponses ? JSON.stringify(responses) : '';

  return request(path, {
    body,
    headers: hasResponses
      ? {
          'Content-Type': 'application/json',
        }
      : undefined,
  });
}

export async function scoreFormResponses(formOid, responses = []) {
  if (!formOid) {
    throw new PromisError('Form OID is required', 400);
  }
  if (!Array.isArray(responses) || responses.length === 0) {
    throw new PromisError('Responses payload is required for scoring', 400);
  }

  return request(`Score/${formOid}.json?BodyParam=true`, {
    body: JSON.stringify(responses),
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

export function isPediatricForm(form) {
  if (!form) {
    return false;
  }
  if (PEDIATRIC_PAIN_INTERFERENCE_SHORT_FORM_OIDS.has(form.OID)) {
    return true;
  }
  const fields = [
    form.Name ?? '',
    form.Title ?? '',
    form.Description ?? '',
    form.Population ?? '',
    Array.isArray(form.Keywords) ? form.Keywords.join(' ') : '',
  ];

  return fields.join(' ').toLowerCase().includes('pediatric');
}
