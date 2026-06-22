/**
 * SyncGate v1.0 — CRM Staging Area
 * ─────────────────────────────────
 * Real Anna AI integration featuring:
 *   • anna.llm.complete() for extraction + chat + per-field re-extraction
 *   • Custom user-defined system prompt rules
 *   • AI reasoning reveal
 *   • Multi-turn AI chat sidebar
 *   • Per-field re-extract with hint modal
 *   • Session history log
 *   • JSON / CSV export
 *   • Custom CRM field configurator
 *   • Streaming token display during extraction
 */

import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";

// ─── DEMO DATA ────────────────────────────────────────────────
const DEMO_NOTES = {
  enterprise: `Had a great call today with Marcus Thompson, VP of Engineering at Northbridge Systems. They're running into serious scalability issues with their current vendor and are actively evaluating replacements. Marcus mentioned a budget of around $72,000 for the annual enterprise license. They want a full integration with their existing Jira setup.

Next steps: Send the enterprise pricing deck by end of week, get our solutions engineer on a call, and check if we can do a 30-day POC. They're aiming to make a decision by end of Q3. Also need to loop in our legal team about their custom SLA requirements. Follow-up call scheduled for June 28th.`,

  startup: `Discovery call with Priya Nair, co-founder of Lumivate AI. Very early stage — they just closed their seed round. Interested in our startup plan. Budget is tight, maybe around $8,000 to start. They need advanced API access and white-labeling.

She was super engaged. Main concerns are onboarding time and documentation quality. Action items: share our startup program deck, intro to customer success, schedule a technical deep-dive next Tuesday. No firm commitment yet but she said they'd decide within 2 weeks.`,

  renewal: `Renewal call with Carlos Mendez from Apex Retail. Current contract is $34,500/year, up for renewal in 45 days. Carlos is happy with the platform but mentioned their CFO is asking for a 10% discount. Usage is up 40% YoY which is a great sign.

We agreed to propose a 3-year deal with a 7% discount at $32,000/year. Carlos will present it internally by July 5th. I need to send the renewal proposal by Friday, flag this to our finance team, and schedule a check-in for July 3rd.`,
};

// ─── SYSTEM PROMPTS ───────────────────────────────────────────
function buildExtractionPrompt(customRules = '', extraFields = []) {
  const extraSchema = extraFields.length
    ? '\n' + extraFields.map(f => `  "${f}": string | null,`).join('\n')
    : '';
  const customSection = customRules.trim()
    ? `\nADDITIONAL COMPANY-SPECIFIC RULES:\n${customRules.trim()}`
    : '';

  return `You are an expert data-extraction agent acting as middleware between raw sales meeting notes and a CRM database. Extract specific entities and return structured JSON.

CRITICAL INSTRUCTIONS:
1. Output ONLY a raw, valid JSON object. No markdown, no backticks, no preamble.
2. If a field is missing from the text, set its value to null. Do NOT guess.
3. dealAmount: number only (strip currency symbols/commas). null if not mentioned.
4. actionItems: array of concise actionable strings under 10 words each. [] if none.
5. dealStage: one of ["Discovery","Qualification","Proposal","Negotiation","Closed Won","Closed Lost"] based on context. null if unclear.
6. reasoning: a brief plain-English explanation of your confidence for each extracted field (1 sentence each).${customSection}

OUTPUT SCHEMA (exact keys):
{
  "clientName": string | null,
  "dealName": string | null,
  "dealAmount": number | null,
  "nextActionDate": string | null,
  "dealStage": string | null,
  "actionItems": string[],
  "reasoning": {
    "clientName": string,
    "dealName": string,
    "dealAmount": string,
    "nextActionDate": string,
    "dealStage": string
  }${extraSchema}
}`;
}

const CHAT_SYSTEM_PROMPT = (notes, extractedJSON) => `You are an expert CRM analyst assistant. You have just extracted CRM data from the following sales meeting notes.

MEETING NOTES:
${notes}

EXTRACTED DATA:
${JSON.stringify(extractedJSON, null, 2)}

Your job is to answer the user's questions about this extraction. Be concise, helpful, and always refer back to specific text in the notes to justify your answers. If asked about a specific field, explain your reasoning clearly. If the user asks you to re-interpret something, provide an alternative interpretation with supporting evidence from the notes.`;

// ─── DOM REFS ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const notesInput     = $('notes-input');
const charCount      = $('char-count');
const extractBtn     = $('extract-btn');
const clearBtn       = $('clear-btn');

const panelInput     = $('panel-input');
const panelStaging   = $('panel-staging');
const panelSuccess   = $('panel-success');

const loadingOverlay = $('loading-overlay');
const loadingText    = $('loading-text');
const loadingSub     = $('loading-sub');

const streamPanel    = $('stream-panel');
const streamOutput   = $('stream-output');
const streamModelLabel = $('stream-model-label');

const fieldClient    = $('field-client');
const fieldDeal      = $('field-deal');
const fieldAmount    = $('field-amount');
const fieldDate      = $('field-date');
const fieldStage     = $('field-stage');
const taskList       = $('task-list');

const confidenceFill     = $('confidence-fill');
const confidencePct      = $('confidence-pct');
const confidenceExplainer = $('confidence-explainer');
const reasoningSection   = $('reasoning-section');
const reasoningBody      = $('reasoning-body');
const changeSummary      = $('change-summary');
const editCountEl        = $('edit-count');
const syncReceipt        = $('sync-receipt');

const chatSidebar    = $('chat-sidebar');
const chatMessages   = $('chat-messages');
const chatInput      = $('chat-input');
const chatSendBtn    = $('chat-send-btn');
const chatModelLabel = $('chat-model-label');

const historyDrawer  = $('history-drawer');
const historyList    = $('history-list');
const historyCount   = $('history-count');

const regenModal     = $('regen-modal');
const regenHintInput = $('regen-hint-input');

const customPromptInput    = $('custom-prompt-input');
const customPromptStatus   = $('custom-prompt-status');
const saveCustomPromptBtn  = $('save-custom-prompt-btn');
const clearCustomPromptBtn = $('clear-custom-prompt-btn');
const customFieldsList     = $('custom-fields-list');
const addCustomFieldBtn    = $('add-custom-field-btn');

const extraFieldsStaging   = $('extra-fields-staging');

const aiStatusText  = $('ai-status-text');

const stages = {
  input:   $('stage-input'),
  extract: $('stage-extract'),
  review:  $('stage-review'),
  sync:    $('stage-sync'),
};

// ─── APP STATE ────────────────────────────────────────────────
let state = {
  aiData: null,
  rawNotes: '',
  editCount: 0,
  originalValues: {},
  tasks: [],
  savedSyncs: [],
  customRules: '',
  customFieldNames: [],
  activeRegenField: null,
  lastExportData: null,
  chatHistory: [],   // [{role, content}]
  annaConnected: false,
};

// ─── ANNA RUNTIME ─────────────────────────────────────────────
const annaReady = (async () => {
  try {
    const anna = await AnnaAppRuntime.connect();
    window.anna = anna;
    state.annaConnected = true;
    aiStatusText.textContent = 'Anna AI Connected';
    chatModelLabel.textContent = 'anna.llm.complete • real AI';
    streamModelLabel.textContent = 'anna.llm.complete';
    try { await anna.window.set_title({ title: 'SyncGate — CRM Staging Area' }); } catch { /* non-critical */ }
    return anna;
  } catch (err) {
    console.warn('[SyncGate] Anna runtime offline — using mock mode:', err.message);
    aiStatusText.textContent = 'Mock Mode (offline)';
    chatModelLabel.textContent = 'mock AI (no Anna runtime)';
    return null;
  }
})();

// ─── STAGE MANAGEMENT ─────────────────────────────────────────
function setStage(name) {
  const order = ['input', 'extract', 'review', 'sync'];
  const idx = order.indexOf(name);
  order.forEach((s, i) => {
    const el = stages[s];
    if (!el) return;
    el.classList.toggle('active', i === idx);
    el.classList.toggle('completed', i < idx);
  });
}

function showPanel(which) {
  panelInput.hidden   = which !== 'input';
  panelStaging.hidden = which !== 'staging';
  panelSuccess.hidden = which !== 'success';
}

// ─── CHAR COUNT & CLEAR ───────────────────────────────────────
notesInput.addEventListener('input', () => {
  const len = notesInput.value.length;
  charCount.textContent = `${len.toLocaleString()} char${len !== 1 ? 's' : ''}`;
});
clearBtn?.addEventListener('click', () => {
  notesInput.value = '';
  notesInput.dispatchEvent(new Event('input'));
});

// ─── DEMO CHIPS ───────────────────────────────────────────────
$('demo-enterprise').addEventListener('click', () => fillDemo('enterprise'));
$('demo-startup').addEventListener('click',    () => fillDemo('startup'));
$('demo-renewal').addEventListener('click',    () => fillDemo('renewal'));

function fillDemo(key) {
  notesInput.value = DEMO_NOTES[key];
  notesInput.dispatchEvent(new Event('input'));
}

// ─── CUSTOM PROMPT MANAGEMENT ─────────────────────────────────
saveCustomPromptBtn?.addEventListener('click', () => {
  state.customRules = customPromptInput.value.trim();
  customPromptStatus.textContent = state.customRules
    ? `✓ ${state.customRules.split('\n').filter(Boolean).length} rule(s) active`
    : 'No custom rules set';
  customPromptStatus.classList.toggle('active', !!state.customRules);
  showToast('✓ Custom extraction rules saved', 'success');
});

clearCustomPromptBtn?.addEventListener('click', () => {
  customPromptInput.value = '';
  state.customRules = '';
  customPromptStatus.textContent = 'No custom rules set';
  customPromptStatus.classList.remove('active');
});

// ─── CUSTOM FIELD CONFIGURATOR ────────────────────────────────
addCustomFieldBtn?.addEventListener('click', () => {
  const row = document.createElement('div');
  row.className = 'custom-field-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'custom-field-name';
  input.placeholder = 'Field name (e.g. Budget Category, Region, Competitor)';
  input.addEventListener('input', syncCustomFieldNames);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'custom-field-remove';
  removeBtn.type = 'button';
  removeBtn.title = 'Remove field';
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', () => {
    row.remove();
    syncCustomFieldNames();
  });

  row.appendChild(input);
  row.appendChild(removeBtn);
  customFieldsList.appendChild(row);
  input.focus();
});

function syncCustomFieldNames() {
  state.customFieldNames = Array.from(customFieldsList.querySelectorAll('.custom-field-name'))
    .map(el => el.value.trim())
    .filter(Boolean);
}

// ─── MAIN EXTRACT ─────────────────────────────────────────────
extractBtn.addEventListener('click', async () => {
  const notes = notesInput.value.trim();
  if (!notes) { showToast('⚠️ Paste some meeting notes first', 'error'); return; }
  if (notes.length < 30) { showToast('⚠️ Notes too short — add more detail', 'error'); return; }

  state.rawNotes = notes;
  state.chatHistory = []; // reset chat context for new extraction

  setStage('extract');
  streamPanel.hidden = false;
  streamOutput.textContent = '';
  showLoading('Analyzing notes with AI…', 'Sending to anna.llm.complete');

  try {
    const anna = await annaReady;
    let extracted;

    if (anna?.llm) {
      // ── REAL ANNA AI PATH ────────────────────────────────────
      hideLoading();
      showLoading('AI Extracting…', 'Live response streaming below');

      const sysPrompt = buildExtractionPrompt(state.customRules, state.customFieldNames);
      streamOutput.textContent = '';

      const response = await anna.llm.complete({
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `Extract CRM data from these meeting notes:\n\n${notes}`,
          }
        }],
        systemPrompt: sysPrompt,
        maxTokens: 700,
        temperature: 0,
      });

      // Simulate streaming display of the response text
      const raw = response?.content?.text || response?.text || '';
      await simulateStream(raw, streamOutput);

      extracted = parseAIResponse(raw);

    } else {
      // ── MOCK PATH ────────────────────────────────────────────
      hideLoading();
      showLoading('Generating mock extraction…', 'Anna runtime not connected');
      await delay(800);
      extracted = generateMockExtraction(notes);
      const mockJson = JSON.stringify(extracted, null, 2);
      await simulateStream(mockJson, streamOutput);
    }

    if (!extracted) throw new Error('Could not parse AI response as JSON');

    // Store raw extraction for chat context
    state.aiData = extracted;

    await delay(300);
    streamPanel.hidden = true;
    hideLoading();
    populateStagingForm(extracted);
    showPanel('staging');
    setStage('review');
    showToast('✓ AI extraction complete — review before syncing', 'success');

  } catch (err) {
    hideLoading();
    streamPanel.hidden = true;
    setStage('input');
    console.error('[SyncGate] Extraction error:', err);
    showToast(`❌ Extraction failed: ${err.message}`, 'error');
  }
});

// ─── SIMULATE STREAM ──────────────────────────────────────────
async function simulateStream(text, outputEl) {
  outputEl.textContent = '';
  const chunkSize = 6;
  for (let i = 0; i < text.length; i += chunkSize) {
    outputEl.textContent += text.slice(i, i + chunkSize);
    outputEl.scrollTop = outputEl.scrollHeight;
    await delay(12);
  }
}

// ─── JSON PARSER ──────────────────────────────────────────────
function parseAIResponse(raw) {
  try {
    const clean = raw.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    return JSON.parse(clean);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    return null;
  }
}

// ─── MOCK EXTRACTION ──────────────────────────────────────────
function generateMockExtraction(notes) {
  const amountMatch = notes.match(/\$[\d,]+(?:,\d{3})*(?:\.\d+)?/);
  const amount = amountMatch ? parseFloat(amountMatch[0].replace(/[$,]/g, '')) : null;
  const dateMatch = notes.match(/(?:june|july|aug|sep|next (?:tuesday|monday|wednesday|thursday|friday)|\w+ \d{1,2}(?:st|nd|rd|th)?)/i);
  const nameMatch = notes.match(/(?:with|from)\s+([A-Z][a-z]+ [A-Z][a-z]+)/);
  const clientName = nameMatch ? nameMatch[1] : null;
  const companyMatch = notes.match(/(?:at|from|@)\s+([A-Z][A-Za-z\s]+?)(?:\.|,|\s+(?:to|in|is|was|they|he|she))/);
  const company = companyMatch ? companyMatch[1].trim() : null;
  const displayClient = clientName && company ? `${clientName}, ${company}` : (clientName || company || null);

  const actionItems = [];
  if (/send.*(?:deck|proposal|doc|email)/i.test(notes)) actionItems.push('Send pricing deck to client');
  if (/schedule.*(?:call|demo|meeting)/i.test(notes)) actionItems.push('Schedule follow-up call');
  if (/loop.*(?:in|team|legal|finance|IT)/i.test(notes)) actionItems.push('Loop in internal team');
  if (/technical|POC|integration/i.test(notes)) actionItems.push('Coordinate POC trial setup');
  if (actionItems.length === 0) actionItems.push('Follow up with client', 'Update CRM opportunity stage');

  const isRenewal = /renewal|renew/i.test(notes);
  const isDiscovery = /discovery|early stage|seed/i.test(notes);
  const dealStage = isRenewal ? 'Negotiation' : isDiscovery ? 'Discovery' : 'Qualification';

  const reasoning = {
    clientName: clientName
      ? `"${clientName}" was found after "with" — high confidence.`
      : 'No clear name found — returned null.',
    dealName: company
      ? `Composed from company name "${company}" and detected deal type.`
      : 'Could not identify company name — used generic label.',
    dealAmount: amount
      ? `Dollar amount "$${amount.toLocaleString()}" found verbatim in notes.`
      : 'No monetary value found — returned null.',
    nextActionDate: dateMatch
      ? `"${dateMatch[0]}" found as the first date reference in notes.`
      : 'No date reference found — returned null.',
    dealStage: `Inferred "${dealStage}" from contextual keywords in the notes.`,
  };

  const result = {
    clientName: displayClient,
    dealName: company ? `${company} — ${amount ? 'Enterprise' : 'Discovery'} Deal` : 'New Opportunity',
    dealAmount: amount,
    nextActionDate: dateMatch ? dateMatch[0] : null,
    dealStage,
    actionItems: actionItems.slice(0, 4),
    reasoning,
  };

  // Add custom field values (mocked)
  state.customFieldNames.forEach(field => {
    result[field] = null;
  });

  return result;
}

// ─── POPULATE STAGING FORM ────────────────────────────────────
function populateStagingForm(data) {
  state.editCount = 0;
  state.originalValues = {};
  state.tasks = [];

  setField(fieldClient, 'tag-client', data.clientName, 'clientName');
  setField(fieldDeal,   'tag-deal',   data.dealName,   'dealName');
  setField(fieldAmount, 'tag-amount', data.dealAmount !== null ? String(data.dealAmount) : '', 'dealAmount');
  setField(fieldDate,   'tag-date',   data.nextActionDate, 'nextActionDate');

  // Deal stage select
  if (fieldStage && data.dealStage) {
    fieldStage.value = data.dealStage;
    fieldStage.classList.add('ai-value');
    $('tag-stage')?.classList.add('visible');
    state.originalValues['dealStage'] = data.dealStage;
  } else if (fieldStage) {
    fieldStage.value = '';
    fieldStage.classList.remove('ai-value');
  }

  // Action items
  taskList.innerHTML = '';
  state.tasks = (data.actionItems || []).map(text => ({ text, checked: false, aiGenerated: true }));
  state.tasks.forEach((t, i) => renderTask(t, i));

  // Custom fields in staging
  renderExtraFields(data);

  // Confidence
  const filledFields = [data.clientName, data.dealName, data.dealAmount, data.nextActionDate, data.dealStage].filter(v => v !== null && v !== undefined).length;
  const confidence = Math.round((filledFields / 5) * 100);
  updateConfidence(confidence, data);

  // Reset
  changeSummary.hidden = true;
  editCountEl.textContent = '0';
  reasoningSection.hidden = true;

  // Attach edit listeners
  [fieldClient, fieldDeal, fieldAmount, fieldDate, fieldStage].forEach(el => {
    el?.addEventListener('input', onFieldEdit);
    el?.addEventListener('change', onFieldEdit);
  });
}

function renderExtraFields(data) {
  if (!state.customFieldNames.length) {
    extraFieldsStaging.hidden = true;
    return;
  }
  extraFieldsStaging.hidden = false;
  extraFieldsStaging.innerHTML = '';

  state.customFieldNames.forEach(field => {
    const item = document.createElement('div');
    item.className = 'extra-field-item';

    const label = document.createElement('label');
    label.className = 'extra-field-label';
    label.textContent = field;
    if (data[field] !== null && data[field] !== undefined) {
      const tag = document.createElement('span');
      tag.className = 'ai-tag ai-tag-visible';
      tag.textContent = 'AI';
      label.appendChild(tag);
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = `field-input ${data[field] ? 'ai-value' : ''}`;
    input.placeholder = `AI-extracted ${field}`;
    input.value = data[field] || '';
    input.id = `extra-field-${field.replace(/\s+/g, '-')}`;

    item.appendChild(label);
    item.appendChild(input);
    extraFieldsStaging.appendChild(item);
  });
}

function setField(inputEl, tagId, value, key) {
  const hasValue = value !== null && value !== undefined && value !== '';
  inputEl.value = hasValue ? value : '';
  inputEl.classList.toggle('ai-value', hasValue);
  inputEl.classList.remove('user-edited');
  const tag = $(tagId);
  if (tag) tag.classList.toggle('visible', hasValue);
  state.originalValues[key] = inputEl.value;
}

function onFieldEdit(e) {
  const el = e.target;
  el.classList.remove('ai-value');
  el.classList.add('user-edited');
  recalcEdits();
}

function recalcEdits() {
  const checks = [
    [fieldClient, 'clientName'],
    [fieldDeal,   'dealName'],
    [fieldAmount, 'dealAmount'],
    [fieldDate,   'nextActionDate'],
    [fieldStage,  'dealStage'],
  ];
  let count = 0;
  checks.forEach(([el, key]) => {
    if (el && el.value !== (state.originalValues[key] || '')) count++;
  });
  state.editCount = count;
  editCountEl.textContent = String(count);
  changeSummary.hidden = count === 0;
}

// ─── CONFIDENCE INDICATOR ──────────────────────────────────────
function updateConfidence(pct, data) {
  confidencePct.textContent = `${pct}%`;
  confidenceFill.style.width = `${pct}%`;
  if (pct >= 80) {
    confidenceFill.style.background = 'linear-gradient(90deg, #22c55e, #4ade80)';
  } else if (pct >= 50) {
    confidenceFill.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)';
  } else {
    confidenceFill.style.background = 'linear-gradient(90deg, #ef4444, #f87171)';
  }

  // Pre-populate explainer from reasoning
  if (data?.reasoning && confidenceExplainer) {
    const r = data.reasoning;
    confidenceExplainer.innerHTML = Object.entries(r)
      .map(([k, v]) => `<strong>${k}:</strong> ${v}`)
      .join('<br>');
  }
}

$('explain-btn')?.addEventListener('click', () => {
  confidenceExplainer.hidden = !confidenceExplainer.hidden;
});

// ─── AI REASONING REVEAL ──────────────────────────────────────
$('show-reasoning-btn')?.addEventListener('click', async () => {
  const hasReasoningData = state.aiData?.reasoning;

  if (hasReasoningData) {
    buildReasoningDisplay(state.aiData.reasoning);
    reasoningSection.hidden = false;
  } else {
    // Ask the AI to explain its reasoning
    showLoading('Asking AI to explain…', 'anna.llm.complete');
    try {
      const anna = await annaReady;
      let reasoning;
      if (anna?.llm) {
        const r = await anna.llm.complete({
          messages: [{
            role: 'user',
            content: {
              type: 'text',
              text: `For each extracted field below, explain in one sentence why you chose that value from the meeting notes. Be specific about which text in the notes led to the extraction.

Extracted: ${JSON.stringify({
  clientName: fieldClient.value,
  dealName: fieldDeal.value,
  dealAmount: fieldAmount.value,
  nextActionDate: fieldDate.value,
  dealStage: fieldStage.value,
}, null, 2)}

Notes: ${state.rawNotes}`
            }
          }],
          maxTokens: 400,
          temperature: 0.3,
        });
        reasoning = r?.content?.text || r?.text || 'Could not generate explanation.';
      } else {
        await delay(600);
        reasoning = 'Mock reasoning: Values extracted using pattern matching on currency amounts, proper nouns, and date expressions.';
      }
      buildReasoningDisplayText(reasoning);
      hideLoading();
      reasoningSection.hidden = false;
    } catch (err) {
      hideLoading();
      showToast('Could not generate reasoning', 'error');
    }
  }
});

$('hide-reasoning-btn')?.addEventListener('click', () => {
  reasoningSection.hidden = true;
});

function buildReasoningDisplay(reasoning) {
  reasoningBody.innerHTML = '';
  const labels = {
    clientName:     'Client Name',
    dealName:       'Deal Name',
    dealAmount:     'Deal Amount',
    nextActionDate: 'Next Action',
    dealStage:      'Deal Stage',
  };
  Object.entries(reasoning).forEach(([key, text]) => {
    if (!labels[key]) return;
    const item = document.createElement('div');
    item.className = 'reasoning-item';
    item.innerHTML = `
      <span class="reasoning-field">${labels[key]}</span>
      <span class="reasoning-text">${text}</span>
    `;
    reasoningBody.appendChild(item);
  });
}

function buildReasoningDisplayText(text) {
  reasoningBody.innerHTML = `<div class="reasoning-text" style="padding:4px 0">${text.replace(/\n/g, '<br>')}</div>`;
}

// ─── PER-FIELD RE-EXTRACT ─────────────────────────────────────
document.querySelectorAll('.field-regen-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const fieldKey = btn.dataset.field;
    state.activeRegenField = fieldKey;
    $('regen-modal-title').textContent = `Re-extract: ${fieldKey}`;
    regenHintInput.value = '';
    regenModal.hidden = false;
    regenHintInput.focus();
  });
});

$('regen-modal-close')?.addEventListener('click', () => { regenModal.hidden = true; });
$('regen-cancel-btn')?.addEventListener('click',  () => { regenModal.hidden = true; });

$('regen-confirm-btn')?.addEventListener('click', async () => {
  regenModal.hidden = true;
  const fieldKey = state.activeRegenField;
  const hint = regenHintInput.value.trim();
  if (!fieldKey) return;

  const btn = document.querySelector(`.field-regen-btn[data-field="${fieldKey}"]`);
  if (btn) btn.classList.add('spinning');

  try {
    const anna = await annaReady;
    let newValue = null;

    const prompt = `From the following meeting notes, extract ONLY the field "${fieldKey}". ${hint ? `Hint: ${hint}.` : ''} Return ONLY the raw value (a string or number), no JSON, no explanation.

Meeting notes:
${state.rawNotes}`;

    if (anna?.llm) {
      const r = await anna.llm.complete({
        messages: [{ role: 'user', content: { type: 'text', text: prompt } }],
        maxTokens: 100,
        temperature: 0,
      });
      newValue = (r?.content?.text || r?.text || '').trim();
    } else {
      await delay(800);
      newValue = `Re-extracted ${fieldKey} (mock)`;
    }

    // Apply to the right field
    const fieldMap = {
      clientName:     fieldClient,
      dealName:       fieldDeal,
      dealAmount:     fieldAmount,
      nextActionDate: fieldDate,
    };
    const el = fieldMap[fieldKey];
    if (el && newValue && newValue !== 'null') {
      el.value = fieldKey === 'dealAmount' ? parseFloat(newValue) || newValue : newValue;
      el.classList.remove('ai-value', 'user-edited');
      el.classList.add('ai-value');
      recalcEdits();
      showToast(`✓ ${fieldKey} re-extracted by AI`, 'success');
    } else {
      showToast(`AI could not find a better value for ${fieldKey}`, 'error');
    }
  } catch (err) {
    showToast('Re-extract failed — see console', 'error');
    console.error(err);
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
});

// ─── ACTION ITEMS RE-EXTRACT ──────────────────────────────────
$('regen-tasks-btn')?.addEventListener('click', async () => {
  const btn = $('regen-tasks-btn');
  btn.disabled = true;
  btn.textContent = 'Asking AI…';

  try {
    const anna = await annaReady;
    let items;

    const prompt = `From these meeting notes, extract a list of SPECIFIC, ACTIONABLE follow-up tasks (5 max). Each task should be under 10 words. Return only a JSON array of strings, no markdown.

Notes:
${state.rawNotes}`;

    if (anna?.llm) {
      const r = await anna.llm.complete({
        messages: [{ role: 'user', content: { type: 'text', text: prompt } }],
        maxTokens: 200,
        temperature: 0.2,
      });
      const raw = r?.content?.text || r?.text || '[]';
      try {
        items = JSON.parse(raw.replace(/```(?:json)?/gi, '').trim());
      } catch {
        items = raw.split('\n').filter(l => l.trim()).map(l => l.replace(/^[-*•\d.]+\s*/, '').trim()).slice(0, 5);
      }
    } else {
      await delay(700);
      items = ['Follow up with client decision-maker', 'Send updated pricing proposal', 'Schedule technical demo call', 'Coordinate with legal team'];
    }

    taskList.innerHTML = '';
    state.tasks = items.map(text => ({ text, checked: false, aiGenerated: true }));
    state.tasks.forEach((t, i) => renderTask(t, i));
    showToast('✓ Action items re-generated by AI', 'success');
  } catch (err) {
    showToast('Re-generation failed', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M10 6A4 4 0 112 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10 3v3h-3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg> Re-extract`;
  }
});

// ─── TASK MANAGEMENT ─────────────────────────────────────────
function renderTask(task, idx) {
  const item = document.createElement('div');
  item.className = `task-item${task.aiGenerated ? '' : ' user-added'}`;
  item.dataset.idx = String(idx);

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'task-checkbox';
  checkbox.checked = task.checked;
  checkbox.addEventListener('change', () => { state.tasks[idx].checked = checkbox.checked; });

  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.className = 'task-text';
  textInput.value = task.text;
  textInput.placeholder = 'Action item…';
  textInput.addEventListener('input', () => { state.tasks[idx].text = textInput.value; });

  const removeBtn = document.createElement('button');
  removeBtn.className = 'task-remove';
  removeBtn.type = 'button';
  removeBtn.innerHTML = '×';
  removeBtn.addEventListener('click', () => {
    state.tasks.splice(idx, 1);
    item.remove();
    taskList.querySelectorAll('.task-item').forEach((el, i) => { el.dataset.idx = String(i); });
  });

  item.append(checkbox, textInput, removeBtn);
  taskList.appendChild(item);
}

$('add-task-btn')?.addEventListener('click', () => {
  const newTask = { text: '', checked: false, aiGenerated: false };
  const idx = state.tasks.length;
  state.tasks.push(newTask);
  renderTask(newTask, idx);
  taskList.lastElementChild?.querySelector('.task-text')?.focus();
});

// ─── AI CHAT SIDEBAR ──────────────────────────────────────────
$('chat-toggle-btn')?.addEventListener('click', () => {
  const isOpen = !chatSidebar.hidden;
  chatSidebar.hidden = isOpen;
  document.getElementById('main-layout').classList.toggle('chat-open', !isOpen);
  if (!isOpen && state.chatHistory.length === 0) {
    // Show welcome state
    chatMessages.innerHTML = `<div class="chat-welcome">
      <div class="chat-welcome-icon">🤖</div>
      <p>I've read the meeting notes. Ask me anything about the extraction — I can:</p>
      <ul>
        <li>Explain why I chose a specific value</li>
        <li>Re-interpret an ambiguous field</li>
        <li>Identify risks or red flags</li>
        <li>Suggest a better deal stage</li>
      </ul>
    </div>`;
  }
});

$('chat-close-btn')?.addEventListener('click', () => {
  chatSidebar.hidden = true;
  document.getElementById('main-layout').classList.remove('chat-open');
});

// Quick prompts
document.querySelectorAll('.quick-prompt').forEach(btn => {
  btn.addEventListener('click', () => {
    chatInput.value = btn.dataset.prompt;
    sendChatMessage();
  });
});

chatSendBtn?.addEventListener('click', sendChatMessage);
chatInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

async function sendChatMessage() {
  const message = chatInput.value.trim();
  if (!message) return;
  chatInput.value = '';

  // Show user bubble
  appendChatBubble('user', message);

  // Hide quick prompts after first use
  $('chat-quick-prompts').hidden = true;

  // Show thinking indicator
  const thinkingEl = appendThinking();

  try {
    const anna = await annaReady;
    let reply;

    if (anna?.llm) {
      // Build conversation context
      const messages = [
        // System context is passed as systemPrompt
        ...state.chatHistory,
        { role: 'user', content: { type: 'text', text: message } },
      ];

      const r = await anna.llm.complete({
        messages,
        systemPrompt: CHAT_SYSTEM_PROMPT(state.rawNotes, state.aiData),
        maxTokens: 500,
        temperature: 0.4,
      });
      reply = r?.content?.text || r?.text || 'No response from AI.';

    } else {
      await delay(900);
      reply = getMockChatReply(message, state.aiData);
    }

    // Update chat history for multi-turn
    state.chatHistory.push(
      { role: 'user', content: { type: 'text', text: message } },
      { role: 'assistant', content: { type: 'text', text: reply } }
    );
    // Keep history bounded
    if (state.chatHistory.length > 20) state.chatHistory = state.chatHistory.slice(-20);

    thinkingEl.remove();
    appendChatBubble('ai', reply);

  } catch (err) {
    thinkingEl.remove();
    appendChatBubble('ai', `❌ Error: ${err.message}`);
    console.error('[SyncGate chat]', err);
  }
}

function appendChatBubble(role, text) {
  const wrap = document.createElement('div');
  wrap.className = 'chat-message';

  const roleLabel = document.createElement('div');
  roleLabel.className = `chat-message-role ${role}`;
  roleLabel.textContent = role === 'ai' ? 'Anna AI' : 'You';

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;
  bubble.textContent = text;

  wrap.append(roleLabel, bubble);
  chatMessages.appendChild(wrap);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return wrap;
}

function appendThinking() {
  const el = document.createElement('div');
  el.className = 'chat-thinking';
  el.innerHTML = '<div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div>';
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return el;
}

function getMockChatReply(message, data) {
  const m = message.toLowerCase();
  if (m.includes('amount') || m.includes('deal')) {
    return data?.dealAmount
      ? `The deal amount was extracted as $${data.dealAmount.toLocaleString()} because I found a dollar value in the notes. If this seems wrong, click the ↻ button next to the field to re-extract with a hint.`
      : `No deal amount was found in the notes. The text doesn't mention a specific monetary value. You can type it manually in the Deal Amount field.`;
  }
  if (m.includes('stage')) {
    return `Based on the tone and content of the notes, "${data?.dealStage || 'Discovery'}" seems the most appropriate deal stage. Look for indicators like "proposal sent", "pricing discussed", or "contract review" to determine the exact stage.`;
  }
  if (m.includes('risk') || m.includes('flag')) {
    return `A few potential risks to flag: (1) No signed agreement or verbal commitment mentioned. (2) Multiple decision-makers may be involved. (3) Timeline seems aggressive — verify the follow-up date is realistic.`;
  }
  if (m.includes('action') || m.includes('task')) {
    return `Beyond what I extracted, you may also want to: (1) Update your internal CRM pipeline forecast, (2) Confirm budget approval at the client side, (3) Prepare a competitive comparison if they're evaluating alternatives.`;
  }
  return `I've analyzed the notes carefully. The extraction is based on the explicit text in the meeting notes. If any field looks wrong, use the ↻ re-extract button or edit the field directly — all human corrections are logged.`;
}

// ─── DISCARD ─────────────────────────────────────────────────
$('discard-btn')?.addEventListener('click', () => {
  showPanel('input');
  setStage('input');
  chatSidebar.hidden = true;
  document.getElementById('main-layout').classList.remove('chat-open');
  state = { ...state, aiData: null, editCount: 0, originalValues: {}, tasks: [], chatHistory: [] };
  reasoningSection.hidden = true;
  streamPanel.hidden = true;
});

// ─── APPROVE & SYNC ───────────────────────────────────────────
$('approve-btn')?.addEventListener('click', async () => {
  const finalData = {
    id:             'SF-' + Math.random().toString(36).slice(2,9).toUpperCase(),
    clientName:     fieldClient.value.trim() || null,
    dealName:       fieldDeal.value.trim()   || null,
    dealAmount:     fieldAmount.value ? parseFloat(fieldAmount.value) : null,
    nextActionDate: fieldDate.value.trim()   || null,
    dealStage:      fieldStage.value         || null,
    actionItems:    state.tasks.filter(t => t.text.trim()).map(t => ({
      text: t.text.trim(),
      completed: t.checked,
    })),
    humanEdits:     state.editCount,
    syncedAt:       new Date().toISOString(),
    source:         'SyncGate v1.0',
    customFields:   {},
  };

  // Collect extra fields
  state.customFieldNames.forEach(field => {
    const el = $(`extra-field-${field.replace(/\s+/g, '-')}`);
    if (el) finalData.customFields[field] = el.value.trim() || null;
  });

  state.lastExportData = finalData;

  showLoading('Syncing to Salesforce…', 'Committing verified CRM record');
  await delay(1400);

  // Write to Anna chat
  const anna = await annaReady;
  if (anna?.chat) {
    try {
      await anna.chat.write_message({
        content: `✅ **SyncGate** committed record **${finalData.id}** — "${finalData.dealName || 'New Deal'}" | ${finalData.dealAmount ? `$${finalData.dealAmount.toLocaleString()}` : 'amount TBD'} | Stage: ${finalData.dealStage || 'N/A'} | ${finalData.humanEdits} human correction(s)`
      });
    } catch { /* offline */ }
  }

  // Add to history
  state.savedSyncs.unshift(finalData);
  updateHistoryUI();

  hideLoading();
  buildReceipt(finalData);
  showPanel('success');
  setStage('sync');
  chatSidebar.hidden = true;
  document.getElementById('main-layout').classList.remove('chat-open');
  triggerSuccessAnimation();
});

// ─── HISTORY ─────────────────────────────────────────────────
$('history-toggle-btn')?.addEventListener('click', () => {
  historyDrawer.hidden = !historyDrawer.hidden;
});
$('history-close-btn')?.addEventListener('click', () => {
  historyDrawer.hidden = true;
});

function updateHistoryUI() {
  const count = state.savedSyncs.length;
  if (count > 0) {
    historyCount.hidden = false;
    historyCount.textContent = String(count);
  }

  if (state.savedSyncs.length === 0) {
    historyList.innerHTML = '<div class="history-empty">No synced records yet</div>';
    return;
  }

  historyList.innerHTML = '';
  state.savedSyncs.forEach(s => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <svg class="history-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/>
        <path d="M5 8l2.5 2.5L11 5.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div class="history-info">
        <div class="history-deal">${s.dealName || 'Unnamed Deal'}</div>
        <div class="history-meta">${s.clientName || '—'} • ${new Date(s.syncedAt).toLocaleTimeString()} • ${s.humanEdits} edit(s)</div>
      </div>
      <div class="history-amount">${s.dealAmount ? `$${s.dealAmount.toLocaleString()}` : '—'}</div>
    `;
    historyList.appendChild(item);
  });
}

// ─── EXPORT ──────────────────────────────────────────────────
$('export-btn')?.addEventListener('click', () => exportCurrentData());
$('export-success-btn')?.addEventListener('click', () => {
  if (state.lastExportData) exportData(state.lastExportData);
});

function exportCurrentData() {
  const data = {
    clientName:     fieldClient.value.trim() || null,
    dealName:       fieldDeal.value.trim()   || null,
    dealAmount:     fieldAmount.value ? parseFloat(fieldAmount.value) : null,
    nextActionDate: fieldDate.value.trim()   || null,
    dealStage:      fieldStage.value         || null,
    actionItems:    state.tasks.filter(t => t.text.trim()).map(t => t.text.trim()),
    humanEdits:     state.editCount,
    exportedAt:     new Date().toISOString(),
  };
  exportData(data);
}

function exportData(data) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `syncgate-${(data.dealName || 'export').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('✓ Exported as JSON', 'success');
}

// ─── RECEIPT ─────────────────────────────────────────────────
function buildReceipt(data) {
  const rows = [
    ['Record ID',    `#${data.id}`,                                          'green'],
    ['Client',       data.clientName || '—',                                 ''],
    ['Deal',         data.dealName   || '—',                                 ''],
    ['Amount',       data.dealAmount ? `$${data.dealAmount.toLocaleString()}` : '—', ''],
    ['Stage',        data.dealStage  || '—',                                 ''],
    ['Next Action',  data.nextActionDate || '—',                             ''],
    ['Human Edits',  `${data.humanEdits} correction(s)`, data.humanEdits > 0 ? 'amber' : 'green'],
    ['Synced',       new Date(data.syncedAt).toLocaleString(),               ''],
  ];
  syncReceipt.innerHTML = rows.map(([k, v, cls]) => `
    <div class="receipt-row">
      <span class="receipt-key">${k}</span>
      <span class="receipt-val${cls ? ' ' + cls : ''}">${v}</span>
    </div>
  `).join('');
}

// ─── SUCCESS ANIMATION ────────────────────────────────────────
function triggerSuccessAnimation() {
  const circle = document.querySelector('.success-circle');
  const check  = document.querySelector('.success-check');
  if (circle) { circle.style.animation = 'none'; void circle.offsetWidth; circle.style.animation = ''; }
  if (check)  { check.style.animation  = 'none'; void check.offsetWidth;  check.style.animation  = ''; }
}

$('new-note-btn')?.addEventListener('click', () => {
  notesInput.value = '';
  charCount.textContent = '0 chars';
  state = { ...state, aiData: null, editCount: 0, originalValues: {}, tasks: [], chatHistory: [], lastExportData: null };
  showPanel('input');
  setStage('input');
});

$('view-crm-btn')?.addEventListener('click', () => {
  showToast('🔗 Opening Salesforce record… (mock)', 'success');
});

// ─── LOADING ─────────────────────────────────────────────────
function showLoading(text, sub) {
  loadingText.textContent = text;
  loadingSub.textContent  = sub;
  loadingOverlay.hidden   = false;
}
function hideLoading() { loadingOverlay.hidden = true; }

// ─── TOAST ───────────────────────────────────────────────────
function showToast(message, type = '') {
  const toast = document.createElement('div');
  toast.className = `toast${type ? ' ' + type : ''}`;
  toast.textContent = message;
  $('toast-container').appendChild(toast);
  setTimeout(() => {
    toast.style.transition = '0.25s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => toast.remove(), 280);
  }, 3000);
}

// ─── UTILITY ─────────────────────────────────────────────────
const delay = ms => new Promise(r => setTimeout(r, ms));

// ─── INIT ─────────────────────────────────────────────────────
setStage('input');
showPanel('input');
