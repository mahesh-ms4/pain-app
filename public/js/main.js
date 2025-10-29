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
const themeLink = document.getElementById('theme-stylesheet');
const loadPromisBtn = document.getElementById('load-promis-forms');
const promisStatus = document.getElementById('promis-status');
const promisList = document.getElementById('promis-list');
const promisDetailsCache = new Map();
const assessmentSessions = new Map();
const GUID_EMPTY = '00000000-0000-0000-0000-000000000000';
const PAIN_INTERFERENCE_FORM_IDS = new Set(['154D0273-C3F6-4BCE-8885-3194D4CC4596']);

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

if (loadPromisBtn) {
  loadPromisBtn.addEventListener('click', loadPediatricForms);
}

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

function swapTheme(href) {
  if (themeLink) {
    themeLink.setAttribute('href', href);
  }
}

window.useUniversityTheme = function useUniversityTheme() {
  swapTheme('styles.css');
};

window.useNeutralTheme = function useNeutralTheme() {
  swapTheme('styles-neutral.css');
};

async function loadPediatricForms() {
  if (!promisStatus || !promisList) {
    return;
  }

  promisStatus.textContent = 'Loading forms...';
  if (loadPromisBtn) {
    loadPromisBtn.disabled = true;
  }

  try {
    const response = await fetch('/api/promis/forms?category=pediatric');
    if (!response.ok) {
      let details = '';
      try {
        const payload = await response.json();
        details = payload?.details ?? payload?.message ?? '';
      } catch (parseError) {
        // ignore JSON parse errors
      }
      const errMessage = details ? `${response.status}: ${details}` : `Request failed with status ${response.status}`;
      throw new Error(errMessage);
    }
    const data = await response.json();
    const forms = Array.isArray(data?.forms) ? data.forms : [];
    renderPromisForms(forms);
    promisStatus.textContent = forms.length
      ? `Loaded ${forms.length} pediatric forms.`
      : 'No pediatric forms were returned.';
  } catch (error) {
    console.error('Failed to load PROMIS forms', error);
    promisStatus.textContent = `Failed to load forms: ${error.message}`;
  } finally {
    if (loadPromisBtn) {
      loadPromisBtn.disabled = false;
    }
  }
}

function renderPromisForms(forms) {
  assessmentSessions.clear();
  promisList.innerHTML = '';

  if (!forms.length) {
    return;
  }

  forms.forEach((form) => {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = form.Name ?? form.Title ?? 'Untitled Form';
    item.appendChild(title);

    if (form.OID) {
      const oid = document.createElement('div');
      oid.textContent = `OID: ${form.OID}`;
      item.appendChild(oid);
    }

    if (form.Population) {
      const population = document.createElement('div');
      population.textContent = `Population: ${form.Population}`;
      item.appendChild(population);
    }

    if (form.Description) {
      const description = document.createElement('p');
      description.textContent = form.Description;
      item.appendChild(description);
    }

    if (form.OID) {
      const controls = document.createElement('div');
      controls.className = 'promis-actions';

      const button = document.createElement('button');
      button.className = 'secondary';
      button.textContent = 'View Questions';
      button.addEventListener('click', () => toggleFormDetails(form.OID, item));
      controls.appendChild(button);

      const startButton = document.createElement('button');
      startButton.className = 'secondary';
      startButton.textContent = 'Start Assessment';
      startButton.addEventListener('click', () => startPromisAssessment(form, item));
      controls.appendChild(startButton);

      item.appendChild(controls);

      const detailsContainer = document.createElement('div');
      detailsContainer.className = 'promis-details';
      detailsContainer.setAttribute('data-form-oid', form.OID);
      item.appendChild(detailsContainer);

      const assessmentContainer = document.createElement('div');
      assessmentContainer.className = 'promis-assessment';
      assessmentContainer.setAttribute('data-form-oid', form.OID);
      item.appendChild(assessmentContainer);
    }

    promisList.appendChild(item);
  });
}

function isPainInterferenceShortForm(form) {
  if (form?.OID && PAIN_INTERFERENCE_FORM_IDS.has(form.OID)) {
    return true;
  }
  const name = (form?.Name ?? form?.Title ?? '').toLowerCase();
  return (
    name.includes('pain interference') &&
    name.includes('short form') &&
    name.includes('pediatric')
  );
}

async function toggleFormDetails(formOid, listItem) {
  const detailsContainer = listItem.querySelector(`.promis-details[data-form-oid="${formOid}"]`);
  if (!detailsContainer) {
    return;
  }

  if (detailsContainer.dataset.expanded === 'true') {
    detailsContainer.innerHTML = '';
    detailsContainer.dataset.expanded = 'false';
    return;
  }

  detailsContainer.innerHTML = '<p>Loading form questions...</p>';
  detailsContainer.dataset.expanded = 'true';

  try {
    const data = await fetchFormDetails(formOid);
    renderFormDetails(detailsContainer, data);
  } catch (error) {
    console.error(`Failed to fetch details for form ${formOid}`, error);
    detailsContainer.innerHTML = `<p class="error">Failed to load form details: ${error.message}</p>`;
  }
}

async function fetchFormDetails(formOid) {
  if (promisDetailsCache.has(formOid)) {
    return promisDetailsCache.get(formOid);
  }

  const response = await fetch(`/api/promis/forms/${encodeURIComponent(formOid)}`);
  if (!response.ok) {
    let details = '';
    try {
      const payload = await response.json();
      details = payload?.details ?? payload?.message ?? '';
    } catch (parseError) {
      // ignore parse errors
    }
    const errMessage = details ? `${response.status}: ${details}` : `Request failed with status ${response.status}`;
    throw new Error(errMessage);
  }

  const data = await response.json();
  promisDetailsCache.set(formOid, data);
  return data;
}

function renderFormDetails(container, data) {
  container.innerHTML = '';
  const items = getOrderedItems(data);
  if (!items.length) {
    container.innerHTML = '<p>No items found for this form.</p>';
    return;
  }

  const list = document.createElement('ol');
  list.className = 'promis-question-list';

  items.forEach((item) => {
    const listItem = document.createElement('li');
    const questionText = extractQuestionText(item);
    listItem.innerHTML = `<div class="promis-question">${questionText}</div>`;

    const options = extractOptions(item);
    options.sort(compareOptionOrder);
    if (options.length) {
      const optionsList = document.createElement('ul');
      optionsList.className = 'promis-options';
      options.forEach((option) => {
        const optionItem = document.createElement('li');
        optionItem.textContent = option.label;
        optionsList.appendChild(optionItem);
      });
      listItem.appendChild(optionsList);
    }

    list.appendChild(listItem);
  });

  container.appendChild(list);
}

function getOrderedItems(data) {
  const items = Array.isArray(data?.Items) ? [...data.Items] : [];
  items.sort(compareItems);
  return items;
}

function extractQuestionText(item) {
  const elements = Array.isArray(item?.Elements) ? item.Elements : [];
  for (const element of elements) {
    if (element?.Description) {
      return element.Description;
    }
  }
  return item?.ID ?? 'Untitled question';
}

function extractOptions(item) {
  const elements = Array.isArray(item?.Elements) ? item.Elements : [];
  const options = [];
  elements.forEach((element) => {
    if (Array.isArray(element?.Map)) {
      element.Map.forEach((option) => {
        const value = option?.Value ?? '';
        const label = option?.Description ?? '';
        const responseKey =
          option?.ItemResponseOID ??
          option?.ItemResponseOid ??
          option?.ItemResponseID ??
          option?.ItemResponseId ??
          option?.Description ??
          option?.Value ??
          '';
        options.push({
          value,
          label: value ? `(${value}) ${label}` : label,
          order: typeof option?.Value !== 'undefined' ? Number(option.Value) : Number(option?.Order),
          raw: option,
          responseKey,
          displayLabel: option?.Description ?? option?.Label ?? String(responseKey),
        });
      });
    }
  });
  return options;
}

function compareItems(a, b) {
  const orderA = getItemOrder(a);
  const orderB = getItemOrder(b);
  if (orderA !== orderB) {
    return orderA - orderB;
  }
  const idA = (a?.ID ?? '').toString();
  const idB = (b?.ID ?? '').toString();
  return idA.localeCompare(idB);
}

function getItemOrder(item) {
  const candidates = [
    item?.ItemOrder,
    item?.Order,
    item?.Sequence,
    item?.QuestionNumber,
    item?.ItemPosition,
    item?.Position,
    extractLeadingNumber(item?.ID),
  ];

  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }
  }

  return Number.MAX_SAFE_INTEGER;
}

function extractLeadingNumber(text) {
  if (!text) {
    return undefined;
  }
  const match = text.toString().match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function compareOptionOrder(a, b) {
  const orderA = getOptionOrder(a);
  const orderB = getOptionOrder(b);
  if (orderA !== orderB) {
    return orderA - orderB;
  }
  return a.label.localeCompare(b.label);
}

function getOptionOrder(option) {
  if (typeof option?.order === 'number' && !Number.isNaN(option.order)) {
    return option.order;
  }
  const numericValue = Number(option?.value);
  if (!Number.isNaN(numericValue)) {
    return numericValue;
  }
  return Number.MAX_SAFE_INTEGER;
}

async function startPromisAssessment(form, listItem) {
  const formOid = form?.OID;
  if (!formOid) {
    return;
  }
  const container = listItem.querySelector(`.promis-assessment[data-form-oid="${formOid}"]`);
  if (!container) {
    return;
  }

  const shortForm = isPainInterferenceShortForm(form);

  if (shortForm) {
    container.innerHTML = '<p>Preparing short form assessment...</p>';
    try {
      const details = await fetchFormDetails(formOid);
      const items = getOrderedItems(details);
      if (!items.length) {
        container.innerHTML = '<p class="error">No items available for this form.</p>';
        return;
      }
      const session = {
        mode: 'fixed',
        responses: [],
        history: [],
        items,
        currentIndex: 0,
        lastPayload: null,
      };
      assessmentSessions.set(formOid, session);
      renderAssessmentQuestion({
        formOid,
        container,
        item: items[0],
        session,
        allowSkip: false,
      });
    } catch (error) {
      console.error(`Failed to start fixed assessment for ${formOid}`, error);
      container.innerHTML = `<p class="error">Failed to load form details: ${error.message}</p>`;
    }
    return;
  }

  assessmentSessions.set(formOid, {
    mode: 'stateless',
    responses: [],
    history: [],
    lastPayload: null,
  });
  container.innerHTML = '<p>Loading first question...</p>';

  await loadNextAssessmentItem(formOid, container);
}

async function loadNextAssessmentItem(formOid, container, rollbackState) {
  const session = assessmentSessions.get(formOid);
  if (!session) {
    return;
  }

  try {
    const payload = await fetchStatelessAssessment(formOid, session.responses);

    if (Array.isArray(payload?.Items) && payload.Items.length) {
      session.lastPayload = payload;
      session.currentItem = payload.Items[0];
      renderAssessmentQuestion({
        formOid,
        container,
        item: session.currentItem,
        session,
        allowSkip: true,
      });
    } else {
      session.lastPayload = payload;
      renderAssessmentResults(container, payload, session);
      assessmentSessions.delete(formOid);
    }
  } catch (error) {
    console.error(`Failed to fetch next assessment item for ${formOid}`, error);
    if (rollbackState) {
      session.responses = rollbackState.responses;
      session.history = rollbackState.history;
    }
    container.innerHTML = `<p class="error">Failed to load next item: ${error.message}</p>`;
  }
}

async function completeFixedAssessment(formOid, session, container) {
  try {
    container.innerHTML = '<p>Scoring assessment...</p>';
    const payload = await scoreFixedAssessment(formOid, session.responses);
    session.lastPayload = payload;
    renderAssessmentResults(container, payload, session);
    assessmentSessions.delete(formOid);
  } catch (error) {
    console.error(`Failed to score assessment for ${formOid}`, error);
    container.innerHTML = `<p class="error">Failed to score assessment: ${error.message}</p>`;
  }
}

async function fetchStatelessAssessment(formOid, responses) {
  const response = await fetch(`/api/promis/forms/${encodeURIComponent(formOid)}/stateless`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ responses }),
  });

  if (!response.ok) {
    let details = '';
    try {
      const payload = await response.json();
      details = payload?.details ?? payload?.message ?? '';
    } catch (parseError) {
      // ignore
    }
    const errMessage = details ? `${response.status}: ${details}` : `Request failed with status ${response.status}`;
    throw new Error(errMessage);
  }

  return response.json();
}

async function scoreFixedAssessment(formOid, responses) {
  const response = await fetch(`/api/promis/forms/${encodeURIComponent(formOid)}/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ responses }),
  });

  if (!response.ok) {
    let details = '';
    try {
      const payload = await response.json();
      details = payload?.details ?? payload?.message ?? '';
    } catch (parseError) {
      // ignore
    }
    const errMessage = details ? `${response.status}: ${details}` : `Request failed with status ${response.status}`;
    throw new Error(errMessage);
  }

  return response.json();
}

function renderAssessmentQuestion({ formOid, container, item, session, allowSkip = true }) {
  const activeSession = session ?? assessmentSessions.get(formOid);
  if (!activeSession) {
    return;
  }

  const options = extractOptions(item);
  options.sort(compareOptionOrder);

  container.innerHTML = '';

  const form = document.createElement('form');
  form.className = 'promis-assessment-form';

  const prompt = document.createElement('div');
  prompt.className = 'promis-question';
  prompt.textContent = extractQuestionText(item);
  form.appendChild(prompt);

  if (!options.length) {
    const message = document.createElement('p');
    message.textContent = 'No response options available for this item.';
    form.appendChild(message);
    container.appendChild(form);
    return;
  }

  const optionsGroup = document.createElement('div');
  optionsGroup.className = 'promis-options-group';

  options.forEach((option, index) => {
    const optionId = `promis-${formOid}-${item.ID}-${index}`;
    const label = document.createElement('label');
    label.className = 'promis-option';
    label.setAttribute('for', optionId);

    const rawResponseKey = option.responseKey;
    const responseKey = rawResponseKey == null ? '' : String(rawResponseKey);
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'promis-option';
    input.id = optionId;
    input.value = responseKey;
    input.dataset.responseKey = responseKey;
    input.dataset.responseValue = option.value != null ? String(option.value) : '';
    input.dataset.responseLabel = option.displayLabel ?? '';

    const span = document.createElement('span');
    span.textContent = option.label;

    label.appendChild(input);
    label.appendChild(span);

    optionsGroup.appendChild(label);
  });

  form.appendChild(optionsGroup);

  const controls = document.createElement('div');
  controls.className = 'promis-assessment-controls';

  const errorMessage = document.createElement('p');
  errorMessage.className = 'promis-error';
  errorMessage.hidden = true;
  controls.appendChild(errorMessage);

  const submitButton = document.createElement('button');
  submitButton.type = 'submit';
  submitButton.textContent = 'Submit Response';
  controls.appendChild(submitButton);

  let skipButton;
  if (allowSkip) {
    skipButton = document.createElement('button');
    skipButton.type = 'button';
    skipButton.className = 'secondary';
    skipButton.textContent = 'Skip Item';
    controls.appendChild(skipButton);
  }

  form.appendChild(controls);
  container.appendChild(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const selected = form.querySelector('input[name="promis-option"]:checked');
    if (!selected) {
      errorMessage.textContent = 'Please select an option before continuing.';
      errorMessage.hidden = false;
      return;
    }
    errorMessage.hidden = true;

    const rollbackState = activeSession.mode === 'stateless'
      ? {
          responses: [...activeSession.responses],
          history: [...(activeSession.history ?? [])],
        }
      : null;

    const responseOrder = activeSession.responses.length + 1;
    const responseEntry = {
      ItemID: item?.ID ?? '',
      ItemResponseOID: selected.dataset.responseKey,
      Order: responseOrder,
    };
    const historyEntry = {
      itemId: item?.ID ?? '',
      question: extractQuestionText(item),
      response: selected.dataset.responseLabel || selected.dataset.responseKey,
      skipped: false,
    };

    activeSession.responses = [...activeSession.responses, responseEntry];
    activeSession.history = [...(activeSession.history ?? []), historyEntry];

    if (activeSession.mode === 'stateless') {
      container.innerHTML = '<p>Loading next question...</p>';
      await loadNextAssessmentItem(formOid, container, rollbackState);
      return;
    }

    activeSession.currentIndex = (activeSession.currentIndex ?? 0) + 1;
    if (activeSession.currentIndex < activeSession.items.length) {
      container.innerHTML = '<p>Loading next question...</p>';
      const nextItem = activeSession.items[activeSession.currentIndex];
      renderAssessmentQuestion({
        formOid,
        container,
        item: nextItem,
        session: activeSession,
        allowSkip: false,
      });
      return;
    }

    await completeFixedAssessment(formOid, activeSession, container);
  });

  if (allowSkip && skipButton) {
    skipButton.addEventListener('click', async () => {
      const rollbackState = {
        responses: [...activeSession.responses],
        history: [...(activeSession.history ?? [])],
      };

      const responseOrder = activeSession.responses.length + 1;
      const responseEntry = {
        ItemID: item?.ID ?? '',
        ItemResponseOID: GUID_EMPTY,
        Order: responseOrder,
      };
      const historyEntry = {
        itemId: item?.ID ?? '',
        question: extractQuestionText(item),
        response: 'Skipped',
        skipped: true,
      };

      activeSession.responses = [...activeSession.responses, responseEntry];
      activeSession.history = [...(activeSession.history ?? []), historyEntry];

      container.innerHTML = '<p>Loading next question...</p>';
      await loadNextAssessmentItem(formOid, container, rollbackState);
    });
  }
}

function renderAssessmentResults(container, payload, session) {
  container.innerHTML = '';

  const result = document.createElement('div');
  result.className = 'promis-results';

  const heading = document.createElement('p');
  heading.textContent = 'Assessment complete.';
  result.appendChild(heading);

  const serverTScore = parseTScore(payload);

  if (payload?.Theta) {
    const theta = document.createElement('div');
    const thetaNumeric = Number.parseFloat(payload.Theta);
    theta.textContent = Number.isNaN(thetaNumeric)
      ? `Theta: ${payload.Theta}`
      : `Theta: ${thetaNumeric.toFixed(4)}`;
    result.appendChild(theta);

    if (typeof serverTScore === 'number' && !Number.isNaN(serverTScore)) {
      const tScoreEl = document.createElement('div');
      tScoreEl.textContent = `T Score: ${serverTScore.toFixed(1)}`;
      result.appendChild(tScoreEl);
    } else if (!Number.isNaN(thetaNumeric)) {
      const tScore = thetaNumeric * 10 + 50;
      const tScoreEl = document.createElement('div');
      tScoreEl.textContent = `T Score: ${tScore.toFixed(1)}`;
      result.appendChild(tScoreEl);
    }
  } else if (typeof serverTScore === 'number' && !Number.isNaN(serverTScore)) {
    const tScoreEl = document.createElement('div');
    tScoreEl.textContent = `T Score: ${serverTScore.toFixed(1)}`;
    result.appendChild(tScoreEl);
  }

  if (payload?.StdError) {
    const se = document.createElement('div');
    const seNumeric = Number.parseFloat(payload.StdError);
    se.textContent = Number.isNaN(seNumeric)
      ? `Standard Error: ${payload.StdError}`
      : `Standard Error: ${seNumeric.toFixed(4)}`;
    result.appendChild(se);
  }

  if (
    (payload?.Theta == null || payload.Theta === '') &&
    typeof serverTScore !== 'number' &&
    payload?.Message
  ) {
    const note = document.createElement('p');
    note.textContent = `PROMIS response: ${payload.Message}`;
    result.appendChild(note);
  }

  if (Array.isArray(payload?.Items) && payload.Items.length) {
    const note = document.createElement('p');
    note.textContent = 'Additional items returned with the final response.';
    result.appendChild(note);
  }

  const history = Array.isArray(session?.history) ? session.history : [];
  if (history.length) {
    const responsesHeading = document.createElement('h4');
    responsesHeading.textContent = 'Responses Overview';
    result.appendChild(responsesHeading);

    const responsesList = document.createElement('ol');
    responsesList.className = 'promis-question-list';
    history.forEach((entry) => {
      const item = document.createElement('li');
      const question = document.createElement('div');
      question.className = 'promis-question';
      question.textContent = entry.question || entry.itemId || 'Question';
      item.appendChild(question);

      const answer = document.createElement('div');
      answer.textContent = entry.response || (entry.skipped ? 'Skipped' : 'No response');
      item.appendChild(answer);

      responsesList.appendChild(item);
    });

    result.appendChild(responsesList);
  }

  if (session?.lastPayload) {
    const debugDetails = document.createElement('details');
    debugDetails.className = 'promis-debug';
    const summary = document.createElement('summary');
    summary.textContent = 'Show raw PROMIS payload';
    debugDetails.appendChild(summary);

    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(session.lastPayload, null, 2);
    debugDetails.appendChild(pre);
    result.appendChild(debugDetails);
  }

  container.appendChild(result);
}

function parseTScore(payload) {
  if (!payload) {
    return undefined;
  }
  const candidates = [
    payload.tScore,
    payload.TScore,
    payload.tscore,
    payload.Score?.TScore,
    payload.Score?.tScore,
    payload.Results?.TScore,
    payload.Results?.tScore,
    payload.Results?.Score,
  ];

  for (const value of candidates) {
    if (typeof value === 'number' && !Number.isNaN(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const numeric = Number.parseFloat(value);
      if (!Number.isNaN(numeric)) {
        return numeric;
      }
    }
  }

  return undefined;
}
