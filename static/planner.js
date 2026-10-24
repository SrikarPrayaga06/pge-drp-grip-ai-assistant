/**
 * PG&E AI Assisted Public Planning Tool (Senpilot Style Interface)
 * Map-First Architecture, Full Statewide Feeder Network, MW Rollup Legends,
 * County Zoom Pills, Address Geocoding, Smooth Drag-to-Draw, Workflow Skills & Multi-Session
 */

// Application State
const plannerState = {
  mode: 'load', // 'load' | 'solar'
  selectedFeeder: null,
  activePersona: 'all',
  activeWorkflow: null,
  isDrawing: false,
  isDraggingBox: false,
  dragStartLngLat: null,
  networkGeoJSON: null,
  currentSessionId: localStorage.getItem('pge_planner_session_id') || 'planner-session',
  isGenerating: false,
};

// 10 Key PG&E Counties with Coordinates
const COUNTY_PILLS = [
  { name: 'Humboldt County', center: [-123.8695, 40.7450], zoom: 10 },
  { name: 'Lassen County', center: [-120.5542, 40.6736], zoom: 10 },
  { name: 'Plumas County', center: [-120.8385, 39.9926], zoom: 10 },
  { name: 'Butte County', center: [-121.6008, 39.6672], zoom: 10.5 },
  { name: 'Sutter County', center: [-121.6946, 39.0344], zoom: 11 },
  { name: 'Sonoma County', center: [-122.8756, 38.5780], zoom: 10.5 },
  { name: 'Alpine County', center: [-119.8207, 38.5972], zoom: 10 },
  { name: 'Alameda County', center: [-122.1808, 37.7534], zoom: 11.5 },
  { name: 'Fresno County', center: [-119.6450, 36.7468], zoom: 10.5 },
  { name: 'Kern County', center: [-118.8597, 35.3433], zoom: 10 },
];

// OpenFreeMap Light / Positron Style
const POSITRON_STYLE = 'https://tiles.openfreemap.org/styles/positron';

// MapLibre Color Scales for MW Ranges
const LOAD_CAPACITY_SCALE = [
  'case',
  ['==', ['get', 'load_max_mw'], null], '#94a3b8',
  ['<=', ['get', 'load_max_mw'], 0], '#cbd5e1',
  ['<', ['get', 'load_max_mw'], 1], '#86efac',
  ['<', ['get', 'load_max_mw'], 3], '#4ade80',
  ['<', ['get', 'load_max_mw'], 6], '#22c55e',
  ['<', ['get', 'load_max_mw'], 12], '#16a34a',
  '#14532d' // 12+ MW
];

const SOLAR_HOSTING_SCALE = [
  'case',
  ['==', ['get', 'gen_max_mw'], null], '#94a3b8',
  ['<=', ['get', 'gen_max_mw'], 0], '#cbd5e1',
  ['<', ['get', 'gen_max_mw'], 1], '#fef08a',
  ['<', ['get', 'gen_max_mw'], 3], '#facc15',
  ['<', ['get', 'gen_max_mw'], 5], '#fb923c',
  ['<', ['get', 'gen_max_mw'], 8], '#ea580c',
  '#7c2d12' // 8+ MW
];

let map = null;
let countyMarkers = [];
let addressMarker = null;

// DOM Elements
const el = {
  toggleLoad: document.getElementById('toggle-load'),
  toggleSolar: document.getElementById('toggle-solar'),
  feederCard: document.getElementById('feeder-card'),
  cardFeederName: document.getElementById('card-feeder-name'),
  cardLoadCapacity: document.getElementById('card-load-capacity'),
  cardSolarCapacity: document.getElementById('card-solar-capacity'),
  cardSubstation: document.getElementById('card-substation'),
  cardVoltage: document.getElementById('card-voltage'),
  btnCloseCard: document.getElementById('btn-close-card'),
  btnViewGrip: document.getElementById('btn-view-grip'),
  btnAskAiFeeder: document.getElementById('btn-ask-ai-feeder'),
  legendTitle: document.getElementById('legend-title'),
  legendScaleBars: document.getElementById('legend-scale-bars'),
  countyPillsContainer: document.getElementById('county-pills-container'),
  btnToggleWorkflows: document.getElementById('btn-toggle-workflows'),
  workflowCaret: document.getElementById('workflow-caret'),
  workflowsSection: document.getElementById('workflows-section'),
  workflowList: document.getElementById('workflow-list'),
  workflowItems: document.querySelectorAll('.workflow-item-btn'),
  personaChips: document.querySelectorAll('.persona-chip'),
  plannerChatMessages: document.getElementById('planner-chat-messages'),
  plannerChatForm: document.getElementById('planner-chat-form'),
  plannerInput: document.getElementById('planner-input'),
  btnSendPlanner: document.getElementById('btn-send-planner'),
  btnDrawArea: document.getElementById('btn-draw-area'),
  drawingBanner: document.getElementById('drawing-banner'),
  btnCancelDraw: document.getElementById('btn-cancel-draw'),
  sessionSelect: document.getElementById('planner-session-select'),
  btnNewSession: document.getElementById('btn-new-session'),
  btnClearChat: document.getElementById('btn-clear-chat'),
};

// Initialize Application
async function initPlanner() {
  initMap();
  setupEventListeners();
  renderLegend();
  await initSessionManagement();
}

function initMap() {
  map = new maplibregl.Map({
    container: 'planner-map',
    style: POSITRON_STYLE,
    center: [-120.3, 37.6], // Central California
    zoom: 6.4,
    minZoom: 5.5,
    maxZoom: 18,
    bearing: 0,
    pitch: 0,
    attributionControl: false
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right');
  map.addControl(new maplibregl.AttributionControl({
    customAttribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> &copy; OSM | PG&E DRP'
  }), 'bottom-left');

  map.on('load', async () => {
    setupMapLayers();
    setupCountyPills();
    setupDragToDrawEvents();
    await loadStatewideFeederNetwork();
  });

  // Toggle county pills visibility based on zoom level
  map.on('zoom', () => {
    const zoom = map.getZoom();
    const show = zoom < 8.8;
    countyMarkers.forEach(m => {
      const element = m.getElement();
      if (element) element.style.display = show ? 'flex' : 'none';
    });
  });
}

function setupMapLayers() {
  // 1. Feeder Network GeoJSON Source
  map.addSource('feeder-network', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    tolerance: 0.5
  });

  // 2. Highlight/Selected Halo Layer
  map.addLayer({
    id: 'feeder-lines-highlight',
    type: 'line',
    source: 'feeder-network',
    filter: ['==', ['get', 'fid'], ''],
    paint: {
      'line-color': '#0284c7',
      'line-width': 7,
      'line-opacity': 0.85
    }
  });

  // 3. Statewide Feeder Polyline Layer
  map.addLayer({
    id: 'feeder-lines-network',
    type: 'line',
    source: 'feeder-network',
    layout: {
      'line-join': 'round',
      'line-cap': 'round'
    },
    paint: {
      'line-color': LOAD_CAPACITY_SCALE,
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        6, 1.2,
        9, 2.0,
        12, 3.2,
        15, 4.5
      ],
      'line-opacity': 0.85
    }
  });

  // 4. Click Hitbox Layer (wider for effortless clicking)
  map.addLayer({
    id: 'feeder-lines-hitbox',
    type: 'line',
    source: 'feeder-network',
    paint: {
      'line-width': 16,
      'line-opacity': 0
    }
  });

  // 5. Drawing Source & Layer for Bounding Box / Polygon Tool
  map.addSource('drawing-source', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });

  map.addLayer({
    id: 'drawing-fill',
    type: 'fill',
    source: 'drawing-source',
    paint: {
      'fill-color': '#0284c7',
      'fill-opacity': 0.18
    }
  });

  map.addLayer({
    id: 'drawing-line',
    type: 'line',
    source: 'drawing-source',
    paint: {
      'line-color': '#0284c7',
      'line-width': 2.5,
      'line-dasharray': [2, 2]
    }
  });

  // Cursor pointer on feeders
  map.on('mouseenter', 'feeder-lines-hitbox', () => {
    if (!plannerState.isDrawing) map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'feeder-lines-hitbox', () => {
    if (!plannerState.isDrawing) map.getCanvas().style.cursor = '';
  });

  // Click Feeder -> Open Feeder Detail Card
  map.on('click', 'feeder-lines-hitbox', (e) => {
    if (plannerState.isDrawing) return;
    if (!e.features || !e.features.length) return;
    selectFeeder(e.features[0].properties);
  });
}

async function loadStatewideFeederNetwork() {
  try {
    const res = await fetch('/api/map/network');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    plannerState.networkGeoJSON = data;

    const src = map.getSource('feeder-network');
    if (src) src.setData(data);

  } catch (err) {
    console.error('Failed to load statewide feeder network:', err);
  }
}

function selectFeeder(props) {
  plannerState.selectedFeeder = props;
  const fid = String(props.fid || '');

  // Highlight feeder line on map
  map.setFilter('feeder-lines-highlight', ['==', ['get', 'fid'], fid]);

  // Format values
  const name = props.name || `Feeder ${fid}`;
  const loadMin = props.load_min_mw !== null ? Number(props.load_min_mw).toFixed(2) : '0';
  const loadMax = props.load_max_mw !== null ? Number(props.load_max_mw).toFixed(2) : '0';
  const genMin = props.gen_min_mw !== null ? Number(props.gen_min_mw).toFixed(2) : '0';
  const genMax = props.gen_max_mw !== null ? Number(props.gen_max_mw).toFixed(2) : '0';

  el.cardFeederName.textContent = name;
  el.cardLoadCapacity.textContent = loadMin === loadMax ? `${loadMax} MW` : `${loadMin}–${loadMax} MW`;
  el.cardSolarCapacity.textContent = genMin === genMax ? `${genMax} MW` : `${genMin}–${genMax} MW`;
  el.cardSubstation.textContent = props.sub || 'Substation';
  el.cardVoltage.textContent = props.kv ? `${props.kv} kV` : '12 kV';

  el.feederCard.classList.add('open');
}

function closeFeederCard() {
  el.feederCard.classList.remove('open');
  map.setFilter('feeder-lines-highlight', ['==', ['get', 'fid'], '']);
  plannerState.selectedFeeder = null;
}

function setupCountyPills() {
  COUNTY_PILLS.forEach(county => {
    const pill = document.createElement('div');
    pill.className = 'county-pill-marker';
    pill.innerHTML = `<span>${county.name}</span><span class="county-pill-arrow">↗</span>`;

    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      map.flyTo({
        center: county.center,
        zoom: county.zoom,
        duration: 1200,
        essential: true
      });
    });

    const marker = new maplibregl.Marker({ element: pill })
      .setLngLat(county.center)
      .addTo(map);

    countyMarkers.push(marker);
  });
}

function setCapacityMode(mode) {
  if (plannerState.mode === mode) return;
  plannerState.mode = mode;

  if (mode === 'load') {
    el.toggleLoad.classList.add('active');
    el.toggleSolar.classList.remove('active');
    map.setPaintProperty('feeder-lines-network', 'line-color', LOAD_CAPACITY_SCALE);
  } else {
    el.toggleSolar.classList.add('active');
    el.toggleLoad.classList.remove('active');
    map.setPaintProperty('feeder-lines-network', 'line-color', SOLAR_HOSTING_SCALE);
  }

  renderLegend();
}

function renderLegend() {
  const isLoad = plannerState.mode === 'load';
  el.legendTitle.textContent = isLoad ? 'Load capacity' : 'Solar hosting';

  const scales = isLoad
    ? [
        { label: '0', color: '#cbd5e1' },
        { label: '>0–<1', color: '#86efac' },
        { label: '1–<3', color: '#4ade80' },
        { label: '3–<6', color: '#22c55e' },
        { label: '6–<12', color: '#16a34a' },
        { label: '12+', color: '#14532d' },
      ]
    : [
        { label: '0', color: '#cbd5e1' },
        { label: '>0–<1', color: '#fef08a' },
        { label: '1–<3', color: '#facc15' },
        { label: '3–<5', color: '#fb923c' },
        { label: '5–<8', color: '#ea580c' },
        { label: '8+', color: '#7c2d12' },
      ];

  el.legendScaleBars.innerHTML = scales.map(s => `
    <div class="legend-bar-item">
      <div class="legend-bar-color" style="background-color: ${s.color};"></div>
      <span class="legend-bar-label">${s.label}</span>
    </div>
  `).join('');
}

// -------------------------------------------------------------
// Smooth Drag-To-Draw Bounding Box Area Feature
// -------------------------------------------------------------
function toggleDrawArea() {
  plannerState.isDrawing = !plannerState.isDrawing;
  const container = map.getCanvasContainer();

  if (plannerState.isDrawing) {
    el.btnDrawArea.classList.add('active');
    el.drawingBanner.style.display = 'flex';
    container.classList.add('drawing-active');
  } else {
    cancelDrawing(true);
  }
}

function cancelDrawing(clearLayer = true) {
  plannerState.isDrawing = false;
  plannerState.isDraggingBox = false;
  plannerState.dragStartLngLat = null;
  el.btnDrawArea.classList.remove('active');
  el.drawingBanner.style.display = 'none';

  const container = map.getCanvasContainer();
  container.classList.remove('drawing-active');
  map.dragPan.enable();

  if (clearLayer) {
    const src = map.getSource('drawing-source');
    if (src) src.setData({ type: 'FeatureCollection', features: [] });
  }
}

function setupDragToDrawEvents() {
  const canvas = map.getCanvas();

  // Mouse Down: start drag
  map.on('mousedown', (e) => {
    if (!plannerState.isDrawing) return;
    // Disable map pan so mouse movement draws the box instead
    map.dragPan.disable();
    plannerState.isDraggingBox = true;
    plannerState.dragStartLngLat = e.lngLat;
  });

  // Mouse Move: update box polygon in real-time
  map.on('mousemove', (e) => {
    if (!plannerState.isDrawing || !plannerState.isDraggingBox || !plannerState.dragStartLngLat) return;

    const start = plannerState.dragStartLngLat;
    const current = e.lngLat;

    const minLng = Math.min(start.lng, current.lng);
    const maxLng = Math.max(start.lng, current.lng);
    const minLat = Math.min(start.lat, current.lat);
    const maxLat = Math.max(start.lat, current.lat);

    const polyCoords = [[
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat]
    ]];

    const src = map.getSource('drawing-source');
    if (src) {
      src.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: polyCoords }
        }]
      });
    }
  });

  // Mouse Up: finish box and calculate intersecting circuits
  map.on('mouseup', (e) => {
    if (!plannerState.isDrawing || !plannerState.isDraggingBox || !plannerState.dragStartLngLat) return;

    const start = plannerState.dragStartLngLat;
    const end = e.lngLat;
    plannerState.isDraggingBox = false;
    map.dragPan.enable();

    const minLng = Math.min(start.lng, end.lng);
    const maxLng = Math.max(start.lng, end.lng);
    const minLat = Math.min(start.lat, end.lat);
    const maxLat = Math.max(start.lat, end.lat);

    // Guard against accidental tiny clicks
    const dLng = Math.abs(maxLng - minLng);
    const dLat = Math.abs(maxLat - minLat);
    if (dLng < 0.001 && dLat < 0.001) {
      return;
    }

    finishDragDrawing(minLng, minLat, maxLng, maxLat);
  });
}

function finishDragDrawing(minLng, minLat, maxLng, maxLat) {
  // Find intersecting feeders from statewide network
  const intersecting = [];
  if (plannerState.networkGeoJSON && plannerState.networkGeoJSON.features) {
    for (const feat of plannerState.networkGeoJSON.features) {
      const coords = feat.geometry?.coordinates || [];
      const hits = coords.some(c => c[0] >= minLng && c[0] <= maxLng && c[1] >= minLat && c[1] <= maxLat);
      if (hits) {
        intersecting.push(feat.properties);
      }
    }
  }

  // Calculate capacity summary
  const circuitCount = intersecting.length;
  let totalLoadMax = 0;
  let totalGenMax = 0;
  intersecting.forEach(f => {
    if (f.load_max_mw) totalLoadMax += Number(f.load_max_mw);
    if (f.gen_max_mw) totalGenMax += Number(f.gen_max_mw);
  });

  const centerLng = ((minLng + maxLng) / 2).toFixed(4);
  const centerLat = ((minLat + maxLat) / 2).toFixed(4);

  // Close drawing mode but keep polygon
  cancelDrawing(false);

  // Construct workflow prompt
  let prompt = `Evaluate the grid capacity and solar hosting inside the drawn area [SW: (${minLat.toFixed(3)}, ${minLng.toFixed(3)}) to NE: (${maxLat.toFixed(3)}, ${maxLng.toFixed(3)})] near center (${centerLat}, ${centerLng}).`;
  if (circuitCount > 0) {
    prompt += ` Detected ${circuitCount} intersecting circuits with ~${totalLoadMax.toFixed(1)} MW aggregate load capacity and ~${totalGenMax.toFixed(1)} MW solar hosting capacity. What are the key feeders and substation interconnection constraints in this area?`;
  }

  sendPlannerMessage(prompt, 'find_large_load_sites');
}

// -------------------------------------------------------------
// Session Management & History
// -------------------------------------------------------------
async function initSessionManagement() {
  await loadSessionsList();

  if (el.sessionSelect) {
    el.sessionSelect.addEventListener('change', (e) => {
      switchSession(e.target.value);
    });
  }

  if (el.btnNewSession) {
    el.btnNewSession.addEventListener('click', createNewSession);
  }

  if (el.btnClearChat) {
    el.btnClearChat.addEventListener('click', clearCurrentChat);
  }
}

async function loadSessionsList() {
  if (!el.sessionSelect) return;
  try {
    const res = await fetch('/api/sessions');
    if (!res.ok) return;
    const data = await res.json();
    const sessions = data.sessions || [];

    el.sessionSelect.innerHTML = '';

    // If no sessions, add default
    if (sessions.length === 0) {
      const opt = document.createElement('option');
      opt.value = plannerState.currentSessionId;
      opt.textContent = 'Main Session';
      el.sessionSelect.appendChild(opt);
    } else {
      let foundActive = false;
      sessions.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.session_id;
        const count = s.message_count ? ` (${s.message_count})` : '';
        opt.textContent = `${s.title || s.session_id}${count}`;
        if (s.session_id === plannerState.currentSessionId) {
          opt.selected = true;
          foundActive = true;
        }
        el.sessionSelect.appendChild(opt);
      });

      if (!foundActive) {
        plannerState.currentSessionId = sessions[0].session_id;
        el.sessionSelect.value = sessions[0].session_id;
        localStorage.setItem('pge_planner_session_id', sessions[0].session_id);
      }
    }

    // Load history for selected session
    await loadSessionHistory(plannerState.currentSessionId);

  } catch (err) {
    console.warn('Could not load sessions:', err);
  }
}

async function switchSession(sessionId) {
  if (!sessionId) return;
  plannerState.currentSessionId = sessionId;
  localStorage.setItem('pge_planner_session_id', sessionId);
  await loadSessionHistory(sessionId);
}

async function createNewSession() {
  const newId = 'session_' + Math.random().toString(36).substring(2, 9);
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const title = `Plan ${timeStr}`;

  try {
    await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: newId, title: title })
    });
    plannerState.currentSessionId = newId;
    localStorage.setItem('pge_planner_session_id', newId);
    await loadSessionsList();
    resetChatView();
  } catch (err) {
    console.error('Failed to create new session:', err);
  }
}

async function clearCurrentChat() {
  try {
    await fetch(`/api/history/${encodeURIComponent(plannerState.currentSessionId)}`, {
      method: 'DELETE'
    });
    resetChatView();
    await loadSessionsList();
  } catch (err) {
    console.error('Failed to clear session chat:', err);
  }
}

function resetChatView() {
  el.plannerChatMessages.innerHTML = '';
  el.plannerChatMessages.style.display = 'none';
  el.workflowsSection.classList.remove('collapsed');
  el.workflowItems.forEach(b => b.classList.remove('selected'));
  plannerState.activeWorkflow = null;
  cancelDrawing(true);
  closeFeederCard();
}

async function loadSessionHistory(sessionId) {
  try {
    const res = await fetch(`/api/history/${encodeURIComponent(sessionId)}`);
    if (!res.ok) return;
    const data = await res.json();
    const messages = data.messages || [];

    el.plannerChatMessages.innerHTML = '';

    if (messages.length > 0) {
      el.plannerChatMessages.style.display = 'flex';
      el.workflowsSection.classList.add('collapsed');
      messages.forEach(m => {
        appendPlannerBubble(m.role, m.content);
      });
    } else {
      el.plannerChatMessages.style.display = 'none';
      el.workflowsSection.classList.remove('collapsed');
    }
  } catch (err) {
    console.warn('Could not load session history:', err);
  }
}

// -------------------------------------------------------------
// AI Chat & Workflow Handling
// -------------------------------------------------------------
async function handleChatSubmit(e) {
  if (e) e.preventDefault();
  const text = el.plannerInput.value.trim();
  if (!text || plannerState.isGenerating) return;

  el.plannerInput.value = '';
  await sendPlannerMessage(text, plannerState.activeWorkflow);
}

async function sendPlannerMessage(message, workflow = null) {
  // If user enters an address, try geocoding first to fly the map!
  const addressMatch = message.match(/(?:at|near|address|site:?)\s+([0-9]+[a-zA-Z0-9\s,.-]+(?:CA|California|Oakland|San Francisco|Fresno|San Jose|Bakersfield|Sacramento|Manteca)?)/i);
  if (addressMatch && addressMatch[1] && addressMatch[1].trim().length > 5) {
    geocodeAndFly(addressMatch[1].trim());
  }

  // Append user message
  appendPlannerBubble('user', message);
  el.plannerChatMessages.style.display = 'flex';
  el.workflowsSection.classList.add('collapsed');

  const loadingBubble = appendPlannerBubble('assistant', 'Analyzing grid capacity across PG&E FeatureServer...');
  plannerState.isGenerating = true;
  el.btnSendPlanner.disabled = true;

  try {
    const bodyPayload = {
      message: message,
      session_id: plannerState.currentSessionId,
      workflow: workflow || plannerState.activeWorkflow || null
    };

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    loadingBubble.innerHTML = formatMarkdown(data.reply);

  } catch (err) {
    loadingBubble.innerHTML = `<span style="color: #ef4444;">Error: ${err.message}</span>`;
  } finally {
    plannerState.isGenerating = false;
    el.btnSendPlanner.disabled = false;
    el.plannerChatMessages.scrollTop = el.plannerChatMessages.scrollHeight;
  }
}

async function geocodeAndFly(addressText) {
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(addressText)}`);
    const data = await res.json();
    if (data.matched && data.lon && data.lat) {
      // Add or update pin marker
      if (addressMarker) addressMarker.remove();

      const elMarker = document.createElement('div');
      elMarker.style.width = '24px';
      elMarker.style.height = '24px';
      elMarker.style.borderRadius = '50%';
      elMarker.style.backgroundColor = '#0284c7';
      elMarker.style.border = '3px solid #ffffff';
      elMarker.style.boxShadow = '0 0 15px rgba(2, 132, 199, 0.6)';

      addressMarker = new maplibregl.Marker({ element: elMarker })
        .setLngLat([data.lon, data.lat])
        .setPopup(new maplibregl.Popup({ offset: 12 }).setText(data.address))
        .addTo(map);

      map.flyTo({
        center: [data.lon, data.lat],
        zoom: 13.8,
        duration: 1600,
        essential: true
      });
    }
  } catch (err) {
    console.warn('Geocoding notice:', err);
  }
}

function appendPlannerBubble(role, content) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;
  bubble.innerHTML = role === 'user' ? `<p>${escapeHtml(content)}</p>` : formatMarkdown(content);
  el.plannerChatMessages.appendChild(bubble);
  el.plannerChatMessages.scrollTop = el.plannerChatMessages.scrollHeight;
  return bubble;
}

function formatMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Headers
  html = html.replace(/^### (.*$)/gim, '<h4 style="margin: 6px 0; color: #0284c7;">$1</h4>');
  html = html.replace(/^## (.*$)/gim, '<h3 style="margin: 8px 0; color: #0f172a;">$1</h3>');
  // Tables
  html = html.replace(/((?:\|[^\n]+\|\r?\n)+)/g, (tableBlock) => {
    const lines = tableBlock.trim().split(/\r?\n/).filter(l => l.trim().startsWith('|'));
    if (lines.length < 2) return tableBlock;
    const isSep = /^\|(?:\s*:?-+:?\s*\|)+$/.test(lines[1].trim());
    if (!isSep) return tableBlock;

    const parseRow = (line, tag) => {
      const cells = line.split('|').slice(1, -1);
      return `<tr>${cells.map(c => `<${tag} style="padding: 4px 8px; border-bottom: 1px solid #e2e8f0; font-size: 12px;">${c.trim()}</${tag}>`).join('')}</tr>`;
    };
    const header = `<thead>${parseRow(lines[0], 'th')}</thead>`;
    const body = `<tbody>${lines.slice(2).map(l => parseRow(l, 'td')).join('')}</tbody>`;
    return `<div style="overflow-x: auto; margin: 6px 0;"><table style="width: 100%; border-collapse: collapse;">${header}${body}</table></div>`;
  });
  // Lists
  html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul style="margin: 4px 0 4px 16px;">$1</ul>');
  // Paragraphs
  return html.replace(/\n\n+/g, '<br><br>');
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function setupEventListeners() {
  // Mode toggles
  el.toggleLoad.addEventListener('click', () => setCapacityMode('load'));
  el.toggleSolar.addEventListener('click', () => setCapacityMode('solar'));

  // Feeder Card Close
  el.btnCloseCard.addEventListener('click', closeFeederCard);

  // Link to PG&E GRIP
  el.btnViewGrip.addEventListener('click', () => {
    const fid = plannerState.selectedFeeder?.fid;
    window.open(`https://www.pge.com/en/clean-energy/solar/distribution-resource-planning.html#feeder=${fid || ''}`, '_blank');
  });

  // Ask AI about this Feeder
  el.btnAskAiFeeder.addEventListener('click', () => {
    if (!plannerState.selectedFeeder) return;
    const f = plannerState.selectedFeeder;
    const prompt = `What is the detailed hosting capacity and interconnection status for feeder ${f.name || f.fid} in ${f.sub || 'the'} substation area?`;
    sendPlannerMessage(prompt, 'check_capacity_address');
  });

  // Workflows accordion toggle
  el.btnToggleWorkflows.addEventListener('click', () => {
    const isCollapsed = el.workflowsSection.classList.toggle('collapsed');
    el.workflowCaret.textContent = isCollapsed ? '⌄' : '⌃';
  });

  // Persona filters
  el.personaChips.forEach(chip => {
    chip.addEventListener('click', () => {
      el.personaChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const persona = chip.getAttribute('data-persona');
      plannerState.activePersona = persona;

      // Filter workflows by persona
      el.workflowItems.forEach(btn => {
        const personas = (btn.getAttribute('data-personas') || '').split(',');
        if (persona === 'all' || personas.includes(persona)) {
          btn.style.display = 'block';
        } else {
          btn.style.display = 'none';
        }
      });
    });
  });

  // Preset workflow item click
  el.workflowItems.forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.getAttribute('data-prompt');
      const wf = btn.getAttribute('data-workflow');

      el.workflowItems.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      plannerState.activeWorkflow = wf;

      if (prompt) {
        sendPlannerMessage(prompt, wf);
      }
    });
  });

  // Drawing area
  el.btnDrawArea.addEventListener('click', toggleDrawArea);
  el.btnCancelDraw.addEventListener('click', () => cancelDrawing(true));

  // Keyboard Escape
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (plannerState.isDrawing) cancelDrawing(true);
      else if (plannerState.selectedFeeder) closeFeederCard();
    }
  });

  // Chat submit
  el.plannerChatForm.addEventListener('submit', handleChatSubmit);
  el.plannerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSubmit();
    }
  });
}

// Start
window.addEventListener('DOMContentLoaded', initPlanner);
