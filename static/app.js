/**
 * PG&E DRP Grid Planning AI & Verification Suite - Frontend Logic
 */

// Application State
const state = {
  currentSession: 'default',
  sessions: ['default'],
  isGenerating: false,
  verificationTests: [
    {
      id: 'substations',
      name: 'Substations Search (Layer 8)',
      desc: "Searches substations by name filter ('MISSION') and verifies SubstationID & Existing DG.",
      status: 'pending',
      latency: null,
      summary: 'Ready to test',
      data: null,
    },
    {
      id: 'feeders',
      name: 'Feeder Demographics (Layer 2)',
      desc: "Looks up circuit '022390402' and calculates residential, commercial & total customer counts.",
      status: 'pending',
      latency: null,
      summary: 'Ready to test',
      data: null,
    },
    {
      id: 'ica',
      name: 'ICA Hosting Capacity (Layer 14)',
      desc: "Inspects line sections on feeder '022390402' for load & solar generation headroom (kW) and Screen L status.",
      status: 'pending',
      latency: null,
      summary: 'Ready to test',
      data: null,
    },
    {
      id: 'load_profile',
      name: '8760 Hourly Load Profiles (Layer 18)',
      desc: "Fetches 24-hour load consumption profile for July on feeder '22390402' and computes peak & average kW.",
      status: 'pending',
      latency: null,
      summary: 'Ready to test',
      data: null,
    },
    {
      id: 'fire_threat',
      name: 'CPUC Fire Hazard Zone (Layer 22)',
      desc: 'Performs spatial point-in-polygon query for downtown San Francisco coordinates (-122.4194, 37.7749).',
      status: 'pending',
      latency: null,
      summary: 'Ready to test',
      data: null,
    },
    {
      id: 'grid_deficiencies',
      name: 'Grid Needs Assessment (Layers 20 & 21)',
      desc: 'Retrieves planned grid deficiencies and Locational Net Benefits Analysis (LNBA) candidate deferrals.',
      status: 'pending',
      latency: null,
      summary: 'Ready to test',
      data: null,
    },
  ],
};

// DOM Elements
const elements = {
  navTabs: document.querySelectorAll('.nav-tab'),
  viewPanels: document.querySelectorAll('.view-panel'),
  sessionsList: document.getElementById('sessions-list'),
  btnNewSession: document.getElementById('btn-new-session'),
  currentSessionId: document.getElementById('current-session-id'),
  messagesContainer: document.getElementById('messages-container'),
  welcomeCard: document.getElementById('welcome-card'),
  chatForm: document.getElementById('chat-form'),
  chatInput: document.getElementById('chat-input'),
  btnSend: document.getElementById('btn-send'),
  btnClearChat: document.getElementById('btn-clear-chat'),
  promptChips: document.querySelectorAll('.prompt-chip'),
  modelNameLabel: document.getElementById('model-name-label'),
  pillModel: document.getElementById('pill-model'),
  btnRotateModel: document.getElementById('btn-rotate-model'),
  verifyGrid: document.getElementById('verify-grid'),
  btnRunAllTests: document.getElementById('btn-run-all-tests'),
  statTotal: document.getElementById('stat-total'),
  statPassed: document.getElementById('stat-passed'),
  statFailed: document.getElementById('stat-failed'),
  statLatency: document.getElementById('stat-latency'),
  btnRunQuery: document.getElementById('btn-run-query'),
  selectLayer: document.getElementById('select-layer'),
  inputWhere: document.getElementById('input-where'),
  inputLimit: document.getElementById('input-limit'),
  resultsContainer: document.getElementById('results-container'),
  resultsCount: document.getElementById('results-count'),
  resultsLatency: document.getElementById('results-latency'),
};

function formatModelName(modelSpec) {
  if (!modelSpec) return 'Gemini Flash';
  if (modelSpec.includes('gemini-3.5-flash')) return 'Gemini 3.5 Flash';
  if (modelSpec.includes('gemini-3.1-flash-lite')) return 'Gemini 3.1 Flash-Lite';
  if (modelSpec.includes('gemini-3.6-flash')) return 'Gemini 3.6 Flash';
  if (modelSpec.includes('gemini-flash-lite-latest')) return 'Gemini Flash-Lite';
  if (modelSpec.includes('gemini-2.5-flash')) return 'Gemini 2.5 Flash';
  if (modelSpec.includes('llama3.2') || modelSpec.includes('ollama')) return 'Ollama Llama 3.2';
  return modelSpec.replace('google_genai:', '').replace('ollama:', '');
}

// Markdown Parser for Assistant Responses with Full Table Support
function renderMarkdown(text) {
  if (!text) return '';
  if (typeof window.marked !== 'undefined' && typeof window.marked.parse === 'function') {
    let html = window.marked.parse(text, { gfm: true, breaks: true });
    // Wrap tables in table-wrapper for clean scrolling on any screen width
    html = html.replace(/<table(\s*[^>]*)>/gi, '<div class="table-wrapper"><table$1>');
    html = html.replace(/<\/table>/gi, '</table></div>');
    return html;
  }

  // Fallback Vanilla GFM parser supporting tables, code, lists, and formatting
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks ```code```
  html = html.replace(/```([\s\S]*?)```/g, (match, p1) => {
    return `<pre><code>${p1.trim()}</code></pre>`;
  });

  // Inline code `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Headers ###
  html = html.replace(/^### (.*$)/gim, '<h4 style="margin: 8px 0 4px; color: var(--cyan-glow);">$1</h4>');
  html = html.replace(/^## (.*$)/gim, '<h3 style="margin: 10px 0 6px; color: var(--cyan-glow);">$1</h3>');
  html = html.replace(/^# (.*$)/gim, '<h2 style="margin: 12px 0 8px; color: var(--cyan-glow);">$1</h2>');

  // GFM Markdown Table Parser
  html = html.replace(/((?:\|[^\n]+\|\r?\n)+)/g, (tableBlock) => {
    const lines = tableBlock.trim().split(/\r?\n/).filter(l => l.trim().startsWith('|'));
    if (lines.length < 2) return tableBlock;
    
    // Check if second line is separator
    const isSep = /^\|(?:\s*:?-+:?\s*\|)+$/.test(lines[1].trim());
    if (!isSep) return tableBlock;

    const parseRow = (line, tag) => {
      const cells = line.split('|').slice(1, -1);
      return `<tr>${cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('')}</tr>`;
    };

    const header = `<thead>${parseRow(lines[0], 'th')}</thead>`;
    const bodyRows = lines.slice(2).map(l => parseRow(l, 'td')).join('');
    const body = `<tbody>${bodyRows}</tbody>`;
    return `<div class="table-wrapper"><table class="data-table">${header}${body}</table></div>`;
  });

  // Unordered list items (- or *)
  html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');

  // Paragraphs
  const blocks = html.split(/\n\n+/);
  return blocks
    .map(p => {
      p = p.trim();
      if (p.startsWith('<pre>') || p.startsWith('<ul>') || p.startsWith('<h') || p.startsWith('<div class="table-wrapper">')) {
        return p;
      }
      return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}

// Initialize Application
async function init() {
  setupNavigation();
  setupChatHandlers();
  setupModelRotation();
  setupVerificationBench();
  setupLayerExplorer();
  await checkHealth();
  await loadSessions();
}

// 1. Navigation Logic
function setupNavigation() {
  elements.navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-tab');
      elements.navTabs.forEach(t => t.classList.remove('active'));
      elements.viewPanels.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(targetId)?.classList.add('active');
    });
  });
}

// 2. Health & Status
async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    if (res.ok) {
      const data = await res.json();
      if (data.active_model) {
        elements.modelNameLabel.textContent = formatModelName(data.active_model);
        elements.pillModel?.setAttribute('title', `Active: ${data.active_model} (Click to rotate model)`);
      }
    }
  } catch (err) {
    console.warn('Health check error:', err);
  }
}

function setupModelRotation() {
  const handleRotate = async (e) => {
    e.stopPropagation();
    if (elements.btnRotateModel) {
      elements.btnRotateModel.style.transform = 'rotate(360deg)';
    }
    try {
      const res = await fetch('/api/models/rotate', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        elements.modelNameLabel.textContent = formatModelName(data.active_model);
        elements.pillModel?.setAttribute('title', `Active: ${data.active_model} (Click to rotate model)`);
      }
    } catch (err) {
      console.warn('Rotation error:', err);
    } finally {
      setTimeout(() => {
        if (elements.btnRotateModel) elements.btnRotateModel.style.transform = 'none';
      }, 350);
    }
  };

  elements.pillModel?.addEventListener('click', handleRotate);
  elements.btnRotateModel?.addEventListener('click', handleRotate);
}


// 3. Sessions
async function loadSessions() {
  try {
    const res = await fetch('/api/sessions');
    if (res.ok) {
      const data = await res.json();
      if (data.sessions && data.sessions.length > 0) {
        state.sessions = data.sessions;
      }
    }
  } catch (err) {
    console.warn('Error loading sessions:', err);
  }
  renderSessionsList();
}

function renderSessionsList() {
  elements.sessionsList.innerHTML = '';
  state.sessions.forEach(sid => {
    const btn = document.createElement('button');
    btn.className = `session-item ${sid === state.currentSession ? 'active' : ''}`;
    btn.innerHTML = `<span># ${sid}</span>`;
    btn.addEventListener('click', () => switchSession(sid));
    elements.sessionsList.appendChild(btn);
  });
  elements.currentSessionId.textContent = state.currentSession;
}

async function switchSession(sessionId) {
  if (state.currentSession === sessionId) return;
  state.currentSession = sessionId;
  renderSessionsList();
  await loadHistory(sessionId);
}

async function loadHistory(sessionId) {
  elements.messagesContainer.innerHTML = '';
  try {
    const res = await fetch(`/api/history/${encodeURIComponent(sessionId)}`);
    if (res.ok) {
      const data = await res.json();
      const validMessages = (data.messages || []).filter(msg => {
        if (!msg || !msg.content) return false;
        const c = String(msg.content).trim();
        return c !== '' && c !== '[]';
      });
      if (validMessages.length > 0) {
        validMessages.forEach(msg => appendMessage(msg.role, msg.content, false));
        return;
      }
    }
  } catch (err) {
    console.warn('History load error:', err);
  }
  // If empty, show welcome card
  elements.messagesContainer.appendChild(elements.welcomeCard);
}

// 4. Chat Setup
function setupChatHandlers() {
  // Input auto-resize
  elements.chatInput.addEventListener('input', () => {
    elements.chatInput.style.height = 'auto';
    elements.chatInput.style.height = `${Math.min(elements.chatInput.scrollHeight, 160)}px`;
  });

  // Enter to send
  elements.chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      elements.chatForm.requestSubmit();
    }
  });

  // Form submit
  elements.chatForm.addEventListener('submit', async e => {
    e.preventDefault();
    const message = elements.chatInput.value.trim();
    if (!message || state.isGenerating) return;

    elements.chatInput.value = '';
    elements.chatInput.style.height = 'auto';
    await sendMessage(message);
  });

  // Preset chips
  elements.promptChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.getAttribute('data-prompt');
      if (prompt && !state.isGenerating) {
        // Switch to chat view if not active
        document.getElementById('tab-chat').click();
        sendMessage(prompt);
      }
    });
  });

  // New session button
  elements.btnNewSession.addEventListener('click', () => {
    const newId = `session-${Date.now().toString(36)}`;
    state.sessions.unshift(newId);
    switchSession(newId);
  });

  // Clear chat
  elements.btnClearChat.addEventListener('click', () => {
    elements.messagesContainer.innerHTML = '';
    elements.messagesContainer.appendChild(elements.welcomeCard);
  });
}

function appendMessage(role, content, shouldScroll = true) {
  if (!content) return;
  const clean = String(content).trim();
  if (!clean || clean === '[]' || clean === 'null' || clean === 'undefined') return;

  // Remove welcome card if present
  if (document.getElementById('welcome-card')) {
    elements.welcomeCard.remove();
  }

  const row = document.createElement('div');
  row.className = `message-row ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'user' ? 'U' : '⚡';

  const body = document.createElement('div');
  body.className = 'message-body';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = role === 'user' ? `<p>${content}</p>` : renderMarkdown(content);

  body.appendChild(bubble);
  row.appendChild(avatar);
  row.appendChild(body);

  elements.messagesContainer.appendChild(row);
  if (shouldScroll) {
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
  }
}

function showTypingIndicator() {
  const row = document.createElement('div');
  row.className = 'message-row assistant typing-row';
  row.id = 'typing-indicator-row';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = '⚡';

  const body = document.createElement('div');
  body.className = 'message-body';

  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.innerHTML = `
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
  `;

  body.appendChild(indicator);
  row.appendChild(avatar);
  row.appendChild(body);

  elements.messagesContainer.appendChild(row);
  elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
}

function removeTypingIndicator() {
  document.getElementById('typing-indicator-row')?.remove();
}

async function sendMessage(message) {
  state.isGenerating = true;
  elements.btnSend.disabled = true;

  appendMessage('user', message);
  showTypingIndicator();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        session_id: state.currentSession,
      }),
    });

    removeTypingIndicator();

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      appendMessage('assistant', `⚠️ **Error**: ${errData.detail || 'Failed to generate response'}`);
    } else {
      const data = await res.json();
      appendMessage('assistant', data.reply);
      const activeOrUsed = data.last_used_model || data.model;
      if (activeOrUsed) {
        elements.modelNameLabel.textContent = formatModelName(activeOrUsed);
        elements.pillModel?.setAttribute('title', `Active: ${activeOrUsed} (Click to rotate model)`);
      }
    }
  } catch (err) {
    removeTypingIndicator();
    appendMessage('assistant', `⚠️ **Network Error**: Unable to reach backend server (${err.message}).`);
  } finally {
    state.isGenerating = false;
    elements.btnSend.disabled = false;
    elements.chatInput.focus();
  }
}

// 5. Verification Test Bench
function setupVerificationBench() {
  renderVerificationGrid();

  elements.btnRunAllTests.addEventListener('click', runAllVerificationChecks);
}

function renderVerificationGrid() {
  elements.verifyGrid.innerHTML = '';
  state.verificationTests.forEach(test => {
    const card = document.createElement('div');
    card.className = `test-card ${test.status}`;
    card.id = `card-${test.id}`;

    const badgeIcon = test.status === 'passed' ? '✓' : test.status === 'failed' ? '✕' : '•';

    card.innerHTML = `
      <div class="test-card-top">
        <div class="test-info">
          <h3 class="test-title">${test.name}</h3>
          <p class="test-desc">${test.desc}</p>
        </div>
        <span class="test-badge ${test.status}">
          <span>${badgeIcon}</span>
          <span>${test.status.toUpperCase()}</span>
        </span>
      </div>

      <div class="test-result-box" id="result-box-${test.id}">
        ${test.summary}
      </div>

      <div class="test-card-footer">
        <span class="test-latency" id="latency-${test.id}">${test.latency ? `${test.latency} ms` : '-- ms'}</span>
        <div class="test-actions">
          <button class="btn-secondary btn-payload-toggle" data-id="${test.id}">Payload</button>
          <button class="btn-primary btn-run-single" data-id="${test.id}">Run Check</button>
        </div>
      </div>

      <div class="test-payload-drawer" id="payload-${test.id}">
        ${test.data ? JSON.stringify(test.data, null, 2) : 'No payload yet.'}
      </div>
    `;

    // Attach single run listener
    card.querySelector('.btn-run-single').addEventListener('click', () => runSingleCheck(test.id));

    // Attach payload toggle listener
    card.querySelector('.btn-payload-toggle').addEventListener('click', () => {
      const drawer = document.getElementById(`payload-${test.id}`);
      drawer.classList.toggle('open');
    });

    elements.verifyGrid.appendChild(card);
  });
}

async function runSingleCheck(testId) {
  const test = state.verificationTests.find(t => t.id === testId);
  if (!test) return;

  const card = document.getElementById(`card-${testId}`);
  const resultBox = document.getElementById(`result-box-${testId}`);
  const latencyBox = document.getElementById(`latency-${testId}`);
  const payloadBox = document.getElementById(`payload-${testId}`);

  card.className = 'test-card running';
  card.querySelector('.test-badge').className = 'test-badge running';
  card.querySelector('.test-badge').innerHTML = '<span>•</span><span>RUNNING</span>';
  resultBox.textContent = 'Executing query on ArcGIS FeatureServer...';

  try {
    const res = await fetch(`/api/verify/${encodeURIComponent(testId)}`, { method: 'POST' });
    const result = await res.json();

    test.status = result.status;
    test.latency = result.latency_ms;
    test.summary = result.summary;
    test.data = result.data;

    card.className = `test-card ${result.status}`;
    card.querySelector('.test-badge').className = `test-badge ${result.status}`;
    card.querySelector('.test-badge').innerHTML = `<span>${result.status === 'passed' ? '✓' : '✕'}</span><span>${result.status.toUpperCase()}</span>`;
    resultBox.textContent = result.summary;
    latencyBox.textContent = `${result.latency_ms} ms`;
    payloadBox.textContent = JSON.stringify(result.data, null, 2);

    updateStatsRibbon();
  } catch (err) {
    card.className = 'test-card failed';
    resultBox.textContent = `Network Error: ${err.message}`;
  }
}

async function runAllVerificationChecks() {
  elements.btnRunAllTests.disabled = true;
  elements.btnRunAllTests.textContent = 'Running All Verification Checks...';

  // Mark all cards running
  state.verificationTests.forEach(t => {
    const card = document.getElementById(`card-${t.id}`);
    if (card) {
      card.className = 'test-card running';
      card.querySelector('.test-badge').className = 'test-badge running';
      card.querySelector('.test-badge').innerHTML = '<span>•</span><span>RUNNING</span>';
    }
  });

  try {
    const res = await fetch('/api/verify', { method: 'POST' });
    const data = await res.json();

    if (data.results) {
      data.results.forEach(resItem => {
        const test = state.verificationTests.find(t => t.id === resItem.id);
        if (test) {
          test.status = resItem.status;
          test.latency = resItem.latency_ms;
          test.summary = resItem.summary;
          test.data = resItem.data;
        }

        const card = document.getElementById(`card-${resItem.id}`);
        if (card) {
          card.className = `test-card ${resItem.status}`;
          card.querySelector('.test-badge').className = `test-badge ${resItem.status}`;
          card.querySelector('.test-badge').innerHTML = `<span>${resItem.status === 'passed' ? '✓' : '✕'}</span><span>${resItem.status.toUpperCase()}</span>`;
          document.getElementById(`result-box-${resItem.id}`).textContent = resItem.summary;
          document.getElementById(`latency-${resItem.id}`).textContent = `${resItem.latency_ms} ms`;
          document.getElementById(`payload-${resItem.id}`).textContent = JSON.stringify(resItem.data, null, 2);
        }
      });
    }

    updateStatsRibbon();
  } catch (err) {
    alert(`Error executing verification tests: ${err.message}`);
  } finally {
    elements.btnRunAllTests.disabled = false;
    elements.btnRunAllTests.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
      Run All Verification Checks
    `;
  }
}

function updateStatsRibbon() {
  const passed = state.verificationTests.filter(t => t.status === 'passed').length;
  const failed = state.verificationTests.filter(t => t.status === 'failed').length;
  const latencies = state.verificationTests.filter(t => t.latency !== null).map(t => t.latency);

  elements.statPassed.textContent = passed;
  elements.statFailed.textContent = failed;

  if (latencies.length > 0) {
    const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    elements.statLatency.textContent = `${avg} ms`;
  }
}

// 6. Direct Layer Explorer
function setupLayerExplorer() {
  elements.btnRunQuery.addEventListener('click', async () => {
    const layerId = parseInt(elements.selectLayer.value, 10);
    const where = elements.inputWhere.value.trim() || '1=1';
    const limit = parseInt(elements.inputLimit.value, 10) || 5;

    elements.btnRunQuery.disabled = true;
    elements.btnRunQuery.textContent = 'Querying...';
    elements.resultsContainer.innerHTML = '<div class="empty-state">Fetching layer records from FeatureServer...</div>';

    const t0 = performance.now();
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Query layer ${layerId} with WHERE "${where}" and limit ${limit} directly.`,
          session_id: 'explorer-query',
        }),
      });

      const t1 = performance.now();
      const elapsed = Math.round(t1 - t0);
      elements.resultsLatency.textContent = `Completed in ${elapsed} ms`;

      if (res.ok) {
        const data = await res.json();
        elements.resultsContainer.innerHTML = `<div class="message-bubble">${renderMarkdown(data.reply)}</div>`;
        elements.resultsCount.textContent = `Results retrieved`;
      } else {
        elements.resultsContainer.innerHTML = `<div class="empty-state" style="color: var(--rose-failed);">Query failed</div>`;
      }
    } catch (err) {
      elements.resultsContainer.innerHTML = `<div class="empty-state" style="color: var(--rose-failed);">Error: ${err.message}</div>`;
    } finally {
      elements.btnRunQuery.disabled = false;
      elements.btnRunQuery.textContent = 'Query Layer';
    }
  });
}

// Start
window.addEventListener('DOMContentLoaded', init);
