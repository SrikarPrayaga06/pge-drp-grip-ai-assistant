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
  setupInteractiveMap();
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

      if (targetId === 'map-view' && gridMap) {
        requestAnimationFrame(() => {
          gridMap.resize();
          if (currentFeederData?.bbox) {
            gridMap.fitBounds(currentFeederData.bbox, {
              padding: { top: 75, bottom: 75, left: 395, right: 75 },
              maxZoom: 15,
              duration: 500,
              essential: true,
              easing: (t) => 1 - Math.pow(1 - t, 3)
            });
          }
        });
      }
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

  // If assistant message mentions a feeder or substation, add quick interactive map button
  if (role === 'assistant') {
    let matchedFeeder = null;
    if (content.includes('162611703') || content.includes('1703')) matchedFeeder = '162611703';
    else if (content.includes('162611704') || content.includes('1704')) matchedFeeder = '162611704';
    else if (content.includes('162611707') || content.includes('1707')) matchedFeeder = '162611707';
    else if (content.includes('022390402') || content.includes('22390402')) matchedFeeder = '022390402';
    else if (content.includes('152442108') || content.includes('2108')) matchedFeeder = '152442108';
    else if (content.toLowerCase().includes('manteca')) matchedFeeder = '162611703';

    if (matchedFeeder) {
      const mapBtn = document.createElement('button');
      mapBtn.className = 'map-view-btn';
      mapBtn.innerHTML = `🗺️ View Feeder ${matchedFeeder} on OpenFreeMap`;
      mapBtn.onclick = () => window.viewFeederOnMap(matchedFeeder);
      bubble.appendChild(mapBtn);
    }
  }

  body.appendChild(bubble);
  row.appendChild(avatar);
  row.appendChild(body);

  elements.messagesContainer.appendChild(row);
  if (shouldScroll) {
    requestAnimationFrame(() => {
      elements.messagesContainer.scrollTo({
        top: elements.messagesContainer.scrollHeight,
        behavior: 'smooth'
      });
    });
  }
  return bubble;
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
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        session_id: state.currentSession,
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulatedText = '';
    let isFirst = true;
    let assistantBubble = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const dataJson = trimmed.slice(5).trim();
        if (!dataJson) continue;

        try {
          const ev = JSON.parse(dataJson);
          if (ev.type === 'token') {
            if (isFirst) {
              removeTypingIndicator();
              assistantBubble = appendMessage('assistant', '');
              isFirst = false;
            }
            accumulatedText += ev.content;
            if (assistantBubble) {
              assistantBubble.innerHTML = renderMarkdown(accumulatedText);
              elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
            }
          } else if (ev.type === 'done') {
            if (isFirst) {
              removeTypingIndicator();
              assistantBubble = appendMessage('assistant', ev.reply || accumulatedText);
              isFirst = false;
            } else if (assistantBubble && ev.reply) {
              assistantBubble.innerHTML = renderMarkdown(ev.reply);
            }
            if (ev.model) {
              elements.modelNameLabel.textContent = formatModelName(ev.model);
              elements.pillModel?.setAttribute('title', `Active: ${ev.model} (Click to rotate model)`);
            }
          } else if (ev.type === 'error') {
            throw new Error(ev.error);
          }
        } catch (e) {
          // ignore parsing error
        }
      }
    }

    if (isFirst) {
      // Fallback if no tokens
      removeTypingIndicator();
      const fallbackRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, session_id: state.currentSession }),
      });
      if (fallbackRes.ok) {
        const data = await fallbackRes.json();
        appendMessage('assistant', data.reply);
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

// ==========================================================================
// 7. OpenFreeMap & MapLibre GL Integration
// ==========================================================================

const OPENFREEMAP_STYLES = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  positron: 'https://tiles.openfreemap.org/styles/positron',
  liberty: 'https://tiles.openfreemap.org/styles/liberty',
  bright: 'https://tiles.openfreemap.org/styles/bright'
};

let gridMap = null;
let currentStyle = 'dark';
let activeFeederId = '162611703'; // Default Manteca 1703
let currentFeederData = null;
let selectedFeatureProps = null;

// High-speed client-side caches
const clientFeederCache = new Map();
let clientSubstationsCache = null;
let clientFireDistrictsCache = null;

function setupInteractiveMap() {
  const container = document.getElementById('openfreemap-container');
  if (!container || typeof maplibregl === 'undefined') {
    console.warn('MapLibre GL or map container not found.');
    return;
  }

  // Initialize MapLibre GL map with OpenFreeMap Dark style centered on Central California
  gridMap = new maplibregl.Map({
    container: 'openfreemap-container',
    style: OPENFREEMAP_STYLES[currentStyle],
    center: [-121.218, 37.798], // Manteca coordinates
    zoom: 12.5,
    pitch: 30, // Subtle 3D perspective
    bearing: 0,
    attributionControl: false
  });

  // Add navigation & fullscreen controls
  gridMap.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
  gridMap.addControl(new maplibregl.FullscreenControl(), 'top-right');
  gridMap.addControl(new maplibregl.AttributionControl({
    customAttribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> | PG&E DRP'
  }), 'bottom-left');

  // Once base map style is loaded, setup grid layers & load default feeder
  gridMap.on('load', () => {
    initMapLayers();
    loadFeederOnMap(activeFeederId);
  });

  // Handle style switcher buttons
  document.querySelectorAll('.style-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const styleKey = btn.getAttribute('data-style');
      if (styleKey && OPENFREEMAP_STYLES[styleKey] && styleKey !== currentStyle) {
        document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentStyle = styleKey;
        
        // Re-set style and restore layers once styled
        gridMap.setStyle(OPENFREEMAP_STYLES[currentStyle]);
        gridMap.once('styledata', () => {
          setTimeout(() => {
            initMapLayers();
            if (currentFeederData) {
              renderFeederGeoJSON(currentFeederData, false);
            }
          }, 150);
        });
      }
    });
  });

  // Handle Feeder selector dropdown
  const selectFeeder = document.getElementById('select-map-feeder');
  selectFeeder?.addEventListener('change', (e) => {
    const id = e.target.value;
    if (id) loadFeederOnMap(id);
  });

  // Handle Custom Feeder input & button
  const inputCustom = document.getElementById('input-custom-feeder');
  const btnLoadCustom = document.getElementById('btn-load-custom-feeder');
  btnLoadCustom?.addEventListener('click', () => {
    const val = inputCustom?.value.trim();
    if (val) loadFeederOnMap(val);
  });
  inputCustom?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = inputCustom.value.trim();
      if (val) loadFeederOnMap(val);
    }
  });

  // Handle Layer Visibility Toggles
  document.getElementById('toggle-layer-feeder')?.addEventListener('change', (e) => {
    const vis = e.target.checked ? 'visible' : 'none';
    ['feeder-lines-glow', 'feeder-lines', 'feeder-lines-hitbox'].forEach(lyr => {
      if (gridMap.getLayer(lyr)) gridMap.setLayoutProperty(lyr, 'visibility', vis);
    });
  });

  document.getElementById('toggle-layer-substations')?.addEventListener('change', (e) => {
    const vis = e.target.checked ? 'visible' : 'none';
    if (gridMap.getLayer('feeder-substation-point')) gridMap.setLayoutProperty('feeder-substation-point', 'visibility', vis);
    if (gridMap.getLayer('feeder-substation-halo')) gridMap.setLayoutProperty('feeder-substation-halo', 'visibility', vis);
    if (gridMap.getLayer('all-substations-point')) gridMap.setLayoutProperty('all-substations-point', 'visibility', vis);
  });

  document.getElementById('toggle-layer-fire')?.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    if (isChecked) {
      loadFireDistrictsOnMap();
    } else {
      if (gridMap.getLayer('fire-districts-fill')) gridMap.setLayoutProperty('fire-districts-fill', 'visibility', 'none');
      if (gridMap.getLayer('fire-districts-outline')) gridMap.setLayoutProperty('fire-districts-outline', 'visibility', 'none');
    }
  });

  // Fit to Feeder Button
  document.getElementById('btn-fit-feeder')?.addEventListener('click', () => {
    if (currentFeederData?.bbox) {
      gridMap.fitBounds(currentFeederData.bbox, {
        padding: { top: 70, bottom: 70, left: 390, right: 70 },
        maxZoom: 15,
        duration: 1200
      });
    }
  });

  // Load All Substations Button
  document.getElementById('btn-load-all-subs')?.addEventListener('click', loadAllSubstationsOnMap);

  // Ask Assistant About Selected Feature Button
  const btnAskAbout = document.getElementById('btn-ask-about-feature');
  btnAskAbout?.addEventListener('click', () => {
    if (!selectedFeatureProps) return;
    const section = selectedFeatureProps.CSV_LineSection || 'this section';
    const feeder = selectedFeatureProps.FeederName || activeFeederId;
    const prompt = `What is the ICA hosting capacity and interconnection feasibility for line section ${section} on feeder ${feeder}?`;
    
    // Switch to Chat tab
    document.getElementById('tab-chat')?.click();
    elements.chatInput.value = prompt;
    elements.chatInput.focus();
  });
}

function initMapLayers() {
  if (!gridMap) return;

  // 1. Feeder Lines GeoJSON Source
  if (!gridMap.getSource('feeder-lines-source')) {
    gridMap.addSource('feeder-lines-source', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }

  // 2. Neon Glow underlay line
  if (!gridMap.getLayer('feeder-lines-glow')) {
    gridMap.addLayer({
      id: 'feeder-lines-glow',
      type: 'line',
      source: 'feeder-lines-source',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': [
          'case',
          ['in', 'likely', ['downcase', ['to-string', ['get', 'ScreenL']]]],
          '#10b981',
          '#ef4444'
        ],
        'line-width': 7,
        'line-opacity': 0.35,
        'line-blur': 3
      }
    });
  }

  // 3. Crisp Foreground Line
  if (!gridMap.getLayer('feeder-lines')) {
    gridMap.addLayer({
      id: 'feeder-lines',
      type: 'line',
      source: 'feeder-lines-source',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': [
          'case',
          ['in', 'likely', ['downcase', ['to-string', ['get', 'ScreenL']]]],
          '#34d399', // bright emerald
          '#f87171'  // bright coral red
        ],
        'line-width': 3.5,
        'line-opacity': 0.95
      }
    });
  }

  // 4. Generous Invisible Hitbox for effortless clicking
  if (!gridMap.getLayer('feeder-lines-hitbox')) {
    gridMap.addLayer({
      id: 'feeder-lines-hitbox',
      type: 'line',
      source: 'feeder-lines-source',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-width': 22,
        'line-opacity': 0
      }
    });
  }

  // 5. Feeder Parent Substation Source & Layers
  if (!gridMap.getSource('feeder-substation-source')) {
    gridMap.addSource('feeder-substation-source', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }

  if (!gridMap.getLayer('feeder-substation-halo')) {
    gridMap.addLayer({
      id: 'feeder-substation-halo',
      type: 'circle',
      source: 'feeder-substation-source',
      paint: {
        'circle-radius': 20,
        'circle-color': '#06b6d4',
        'circle-opacity': 0.3,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#38bdf8'
      }
    });
  }

  if (!gridMap.getLayer('feeder-substation-point')) {
    gridMap.addLayer({
      id: 'feeder-substation-point',
      type: 'circle',
      source: 'feeder-substation-source',
      paint: {
        'circle-radius': 9,
        'circle-color': '#0284c7',
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#ffffff'
      }
    });
  }

  // Interactive Cursor & Tooltips for Feeder Lines & Hitbox
  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: false,
    offset: 12
  });

  const handleLineHover = () => { gridMap.getCanvas().style.cursor = 'pointer'; };
  const handleLineLeave = () => { gridMap.getCanvas().style.cursor = ''; };

  const handleLineClick = (e) => {
    if (!e.features || !e.features.length) return;
    const feat = e.features[0];
    const p = feat.properties;
    selectedFeatureProps = p;

    const isPass = (p.ScreenL || '').toLowerCase().includes('likely to pass') && !(p.ScreenL || '').toLowerCase().includes('unlikely');
    const badgeHtml = isPass
      ? '<span style="color: #34d399; font-weight: 700;">🟢 Likely to pass</span>'
      : '<span style="color: #f87171; font-weight: 700;">🔴 Unlikely to pass</span>';

    popup
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-size: 13px; line-height: 1.5;">
          <div style="font-weight: 700; color: #38bdf8; margin-bottom: 4px;">Line Section: ${p.CSV_LineSection || 'N/A'}</div>
          <div><strong>Feeder:</strong> ${p.FeederName || p.FeederId || 'N/A'}</div>
          <div><strong>Solar PV Capacity:</strong> ${p.GenericPVCapacity_kW ? Number(p.GenericPVCapacity_kW).toLocaleString() + ' kW' : 'N/A'}</div>
          <div><strong>Gen Capacity:</strong> ${p.GenCapacity_kW ? Number(p.GenCapacity_kW).toLocaleString() + ' kW' : 'N/A'}</div>
          <div><strong>Load Headroom:</strong> ${p.LoadCapacity_kW ? Number(p.LoadCapacity_kW).toLocaleString() + ' kW' : 'N/A'}</div>
          <div><strong>Screen L Status:</strong> ${badgeHtml}</div>
          <div><strong>Limiting Criteria:</strong> ${p.limiting_criteria || 'None'}</div>
          <div><strong>Voltage:</strong> ${p.voltage_kv || '12'} kV</div>
        </div>
      `)
      .addTo(gridMap);

    updateInspectorCard('Line Section', p, isPass);
  };

  ['feeder-lines', 'feeder-lines-hitbox'].forEach(lyr => {
    gridMap.on('mouseenter', lyr, handleLineHover);
    gridMap.on('mouseleave', lyr, handleLineLeave);
    gridMap.on('click', lyr, handleLineClick);
  });

  // Interactive Substation Click
  gridMap.on('click', 'feeder-substation-point', (e) => {
    if (!e.features || !e.features.length) return;
    const p = e.features[0].properties;
    selectedFeatureProps = p;

    popup
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-size: 13px; line-height: 1.5;">
          <div style="font-weight: 700; color: #c084fc; font-size: 14px; margin-bottom: 4px;">🏢 Substation: ${p.SubstationName || 'N/A'}</div>
          <div><strong>Substation ID:</strong> ${p.SubstationID || 'N/A'}</div>
          <div><strong>Nominal Voltage:</strong> ${p.Voltage_kV || 'N/A'} kV</div>
          <div><strong>Existing DG:</strong> ${p.Existing_DG ? Number(p.Existing_DG).toLocaleString() + ' kW' : '0 kW'}</div>
          <div><strong>Queued DG:</strong> ${p.Queued_DG ? Number(p.Queued_DG).toLocaleString() + ' kW' : '0 kW'}</div>
          <div><strong>Banks:</strong> ${p.NUMBANKS || 'N/A'}</div>
          <div><strong>Division:</strong> ${p.Division || 'N/A'}</div>
        </div>
      `)
      .addTo(gridMap);

    updateInspectorCard('Substation', p, true);
  });
}

function updateInspectorCard(type, props, isPass) {
  const tag = document.getElementById('inspector-tag');
  const badge = document.getElementById('inspector-status-badge');
  const details = document.getElementById('inspector-details');
  const btnAsk = document.getElementById('btn-ask-about-feature');

  if (tag) tag.textContent = type;
  if (badge) {
    badge.textContent = isPass ? 'Likely to pass' : 'Review Required';
    badge.className = 'feature-status-badge ' + (isPass ? 'pass' : 'unlikely');
  }

  if (details) {
    if (type === 'Line Section') {
      details.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div><strong style="color: var(--text-primary);">Section ID:</strong> ${props.CSV_LineSection || 'N/A'}</div>
          <div><strong style="color: var(--text-primary);">Solar PV Cap:</strong> <span style="color: var(--cyan-glow); font-family: var(--font-mono);">${props.GenericPVCapacity_kW ? Number(props.GenericPVCapacity_kW).toLocaleString() + ' kW' : '0 kW'}</span></div>
          <div><strong style="color: var(--text-primary);">Generation Cap:</strong> <span style="color: #34d399; font-family: var(--font-mono);">${props.GenCapacity_kW ? Number(props.GenCapacity_kW).toLocaleString() + ' kW' : '0 kW'}</span></div>
          <div><strong style="color: var(--text-primary);">Load Capacity:</strong> ${props.LoadCapacity_kW ? Number(props.LoadCapacity_kW).toLocaleString() + ' kW' : '0 kW'}</div>
          <div><strong style="color: var(--text-primary);">Limiting Criteria:</strong> ${props.limiting_criteria || 'None'}</div>
          <div><strong style="color: var(--text-primary);">Voltage:</strong> ${props.voltage_kv || '12'} kV (${props.phase_cnt || 3}-Phase)</div>
        </div>
      `;
    } else {
      details.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div><strong style="color: var(--text-primary);">Substation:</strong> ${props.SubstationName || 'N/A'}</div>
          <div><strong style="color: var(--text-primary);">Voltage:</strong> ${props.Voltage_kV || 'N/A'} kV</div>
          <div><strong style="color: var(--text-primary);">Installed DG:</strong> ${props.Existing_DG ? Number(props.Existing_DG).toLocaleString() + ' kW' : '0 kW'}</div>
          <div><strong style="color: var(--text-primary);">Queued DG:</strong> ${props.Queued_DG ? Number(props.Queued_DG).toLocaleString() + ' kW' : '0 kW'}</div>
          <div><strong style="color: var(--text-primary);">Division:</strong> ${props.Division || 'N/A'}</div>
        </div>
      `;
    }
  }

  if (btnAsk) btnAsk.style.display = 'block';
}

function applyFeederStatsToUI(data, hudFeeder, hudSub, hudSections, hudScreen, hudGen) {
  const fMeta = data.feeder_meta || {};
  const subName = fMeta.Substation || (data.substation_feature?.properties?.SubstationName) || 'Substation';
  const volt = fMeta.Nominal_Voltage ? `${fMeta.Nominal_Voltage} kV` : '12 kV';

  if (hudFeeder) hudFeeder.textContent = fMeta.Feeder_Name || `Feeder ${data.feeder_id || activeFeederId}`;
  if (hudSub) hudSub.textContent = `${subName} (${volt})`;
  if (hudSections) hudSections.textContent = data.summary?.total_sections || data.count || 0;
  if (hudScreen) {
    hudScreen.textContent = `${data.summary?.screen_l_pass || 0} Passed / ${data.summary?.screen_l_unlikely || 0} Unlikely`;
  }
  if (hudGen) {
    hudGen.textContent = (data.summary?.max_gen_capacity_kw ? Number(data.summary.max_gen_capacity_kw).toLocaleString() : '0') + ' kW';
  }

  // Auto-populate inspector card with a representative line section
  if (data.features && data.features.length > 0) {
    const sample = data.features[0].properties;
    const isPass = (sample.ScreenL || '').toLowerCase().includes('likely to pass') && !(sample.ScreenL || '').toLowerCase().includes('unlikely');
    updateInspectorCard('Line Section (Sample)', sample, isPass);
    selectedFeatureProps = sample;
  }
}

async function loadFeederOnMap(feederId) {
  if (!feederId) return;
  const cleanId = String(feederId).trim();
  activeFeederId = cleanId;

  const hudFeeder = document.getElementById('hud-feeder-name');
  const hudSub = document.getElementById('hud-substation-name');
  const hudSections = document.getElementById('hud-sections-count');
  const hudScreen = document.getElementById('hud-screen-l');
  const hudGen = document.getElementById('hud-max-gen');

  // Instant client cache hit (0ms latency, buttery smooth)
  if (clientFeederCache.has(cleanId)) {
    const cachedData = clientFeederCache.get(cleanId);
    currentFeederData = cachedData;
    renderFeederGeoJSON(cachedData, true);
    applyFeederStatsToUI(cachedData, hudFeeder, hudSub, hudSections, hudScreen, hudGen);
    return;
  }

  if (hudFeeder) hudFeeder.textContent = 'Loading Feeder...';

  try {
    const res = await fetch(`/api/map/feeder/${encodeURIComponent(cleanId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    clientFeederCache.set(cleanId, data);
    currentFeederData = data;

    renderFeederGeoJSON(data, true);
    applyFeederStatsToUI(data, hudFeeder, hudSub, hudSections, hudScreen, hudGen);
  } catch (err) {
    console.error('Failed to load feeder GeoJSON:', err);
    if (hudFeeder) hudFeeder.textContent = `Error loading ${cleanId}`;
  }
}

function renderFeederGeoJSON(data, animateCamera = true) {
  if (!gridMap) return;

  const linesSource = gridMap.getSource('feeder-lines-source');
  if (linesSource) {
    linesSource.setData({
      type: 'FeatureCollection',
      features: data.features || []
    });
  }

  const subSource = gridMap.getSource('feeder-substation-source');
  if (subSource) {
    subSource.setData({
      type: 'FeatureCollection',
      features: data.substation_feature ? [data.substation_feature] : []
    });
  }

  // Ultra-smooth Camera FitBounds with ease-out cubic curve
  if (animateCamera && data.bbox && data.bbox[0] <= data.bbox[2]) {
    gridMap.fitBounds(data.bbox, {
      padding: { top: 75, bottom: 75, left: 395, right: 75 },
      maxZoom: 15.2,
      duration: 1000,
      essential: true,
      easing: (t) => 1 - Math.pow(1 - t, 3)
    });
  }
}

async function loadAllSubstationsOnMap() {
  if (!gridMap) return;
  try {
    let data = clientSubstationsCache;
    if (!data) {
      const res = await fetch('/api/map/substations');
      data = await res.json();
      clientSubstationsCache = data;
    }

    if (!gridMap.getSource('all-substations-source')) {
      gridMap.addSource('all-substations-source', {
        type: 'geojson',
        data: data
      });

      gridMap.addLayer({
        id: 'all-substations-point',
        type: 'circle',
        source: 'all-substations-source',
        paint: {
          'circle-radius': 6,
          'circle-color': '#a855f7',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });

      gridMap.on('click', 'all-substations-point', (e) => {
        if (!e.features || !e.features.length) return;
        const p = e.features[0].properties;
        new maplibregl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-size: 13px;">
              <strong style="color: #c084fc;">🏢 ${p.SubstationName}</strong>
              <div>Voltage: ${p.Voltage_kV} kV</div>
              <div>Installed DG: ${p.Existing_DG ? Number(p.Existing_DG).toLocaleString() : 0} kW</div>
              <div>Queued DG: ${p.Queued_DG ? Number(p.Queued_DG).toLocaleString() : 0} kW</div>
            </div>
          `)
          .addTo(gridMap);
      });
    } else {
      gridMap.getSource('all-substations-source').setData(data);
      gridMap.setLayoutProperty('all-substations-point', 'visibility', 'visible');
    }
  } catch (err) {
    console.error('Failed to load all substations:', err);
  }
}

async function loadFireDistrictsOnMap() {
  if (!gridMap) return;
  try {
    let data = clientFireDistrictsCache;
    if (!data) {
      const res = await fetch('/api/map/fire-districts');
      data = await res.json();
      clientFireDistrictsCache = data;
    }

    if (!gridMap.getSource('fire-districts-source')) {
      gridMap.addSource('fire-districts-source', {
        type: 'geojson',
        data: data
      });

      gridMap.addLayer({
        id: 'fire-districts-fill',
        type: 'fill',
        source: 'fire-districts-source',
        paint: {
          'fill-color': [
            'case',
            ['==', ['get', 'cpuc_tier'], 3],
            '#ef4444', // Tier 3 extreme
            '#f59e0b'  // Tier 2 elevated
          ],
          'fill-opacity': 0.2
        }
      });

      gridMap.addLayer({
        id: 'fire-districts-outline',
        type: 'line',
        source: 'fire-districts-source',
        paint: {
          'line-color': '#f59e0b',
          'line-width': 1.5,
          'line-dasharray': [2, 2]
        }
      });
    } else {
      gridMap.getSource('fire-districts-source').setData(data);
      gridMap.setLayoutProperty('fire-districts-fill', 'visibility', 'visible');
      gridMap.setLayoutProperty('fire-districts-outline', 'visibility', 'visible');
    }
  } catch (err) {
    console.error('Failed to load fire districts:', err);
  }
}

// Global hook to view any feeder on map from anywhere
window.viewFeederOnMap = function(feederId) {
  document.getElementById('tab-map')?.click();
  const select = document.getElementById('select-map-feeder');
  if (select) {
    let exists = Array.from(select.options).some(o => o.value === String(feederId));
    if (exists) {
      select.value = String(feederId);
    } else {
      const input = document.getElementById('input-custom-feeder');
      if (input) input.value = String(feederId);
    }
  }
  loadFeederOnMap(feederId);
};

// Start
window.addEventListener('DOMContentLoaded', init);

