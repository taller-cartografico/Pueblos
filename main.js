import './style.css';
import maplibregl from 'maplibre-gl';

const GEOJSON_URL = import.meta.env.BASE_URL + 'municipios.geojson';
const TOTAL_MUNICIPIOS = 78;
const FEEDBACK_DELAY_MS = 900;

const COLOR_SUCCESS = '#2f6b4f';
const COLOR_ERROR = '#ba1a1a';
const COLOR_NEUTRAL = '#8f9a94';

const targetNameEl = document.getElementById('target-name');
const progressFillEl = document.getElementById('progress-fill');
const progressFractionEl = document.getElementById('progress-fraction');
const scorePctEl = document.getElementById('score-pct');
const feedbackEl = document.getElementById('feedback');
const resultModalEl = document.getElementById('result-modal');
const resultGradeEl = document.getElementById('result-grade');
const resultPctEl = document.getElementById('result-pct');
const resultDetailEl = document.getElementById('result-detail');
const shareBtn = document.getElementById('share-btn');
const replayBtn = document.getElementById('replay-btn');

function shuffle(array) {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function computeBounds(features) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (coords) => {
    if (typeof coords[0] === 'number') {
      const [x, y] = coords;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    } else {
      coords.forEach(walk);
    }
  };
  features.forEach((f) => walk(f.geometry.coordinates));
  return [[minX, minY], [maxX, maxY]];
}

function gradeFromPercent(pct) {
  if (pct >= 90) return 'A';
  if (pct >= 80) return 'B';
  if (pct >= 70) return 'C';
  if (pct >= 60) return 'D';
  return 'F';
}

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  center: [-66.45, 18.2],
  zoom: 8,
  minZoom: 7,
  maxZoom: 14,
  pitch: 0,
});

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

let queue = [];
let currentIndex = 0;
let correctCount = 0;
let accepting = false;
let gameEnded = false;

function updateStats() {
  const answered = currentIndex;
  progressFillEl.style.width = `${(answered / TOTAL_MUNICIPIOS) * 100}%`;
  progressFractionEl.textContent = `${answered} / ${TOTAL_MUNICIPIOS}`;
  const pct = answered > 0 ? Math.round((correctCount / answered) * 100) : 0;
  scorePctEl.textContent = `${pct}%`;
}

function showNextTarget() {
  if (currentIndex >= queue.length) {
    endGame();
    return;
  }
  const target = queue[currentIndex];
  targetNameEl.textContent = target.municipio;
  feedbackEl.textContent = '';
  feedbackEl.className = 'feedback';
  accepting = true;
}

function endGame() {
  gameEnded = true;
  targetNameEl.textContent = '¡Completado!';
  const pct = Math.round((correctCount / TOTAL_MUNICIPIOS) * 100);
  const grade = gradeFromPercent(pct);
  resultGradeEl.textContent = grade;
  resultPctEl.textContent = `${pct}%`;
  resultDetailEl.textContent = `Acertaste ${correctCount} de ${TOTAL_MUNICIPIOS} municipios.`;
  resultModalEl.classList.remove('hidden');
}

function handleGuess(point) {
  if (!accepting || gameEnded) return;
  accepting = false;

  const target = queue[currentIndex];
  const features = map.queryRenderedFeatures(point, { layers: ['municipios-fill'] });
  const clickedName = features.length > 0 ? features[0].properties.municipio : null;
  const isCorrect = clickedName === target.municipio;

  map.setFeatureState({ source: 'municipios', id: target.objectid }, { result: isCorrect ? 'correct' : 'incorrect' });

  if (isCorrect) {
    correctCount += 1;
    feedbackEl.textContent = '¡Correcto!';
    feedbackEl.className = 'feedback correct';
  } else {
    feedbackEl.textContent = `Incorrecto. Era ${target.municipio}.`;
    feedbackEl.className = 'feedback incorrect';
  }

  currentIndex += 1;
  updateStats();

  setTimeout(showNextTarget, FEEDBACK_DELAY_MS);
}

async function init() {
  const [res] = await Promise.all([
    fetch(GEOJSON_URL).then((r) => r.json()),
    new Promise((resolve) => map.on('load', resolve)),
  ]);

  const layers = map.getStyle().layers;
  const stripKeywords = ['road', 'bridge', 'tunnel', 'path', 'place-city', 'place-town', 'place-village', 'place-hamlet', 'poi'];
  layers.forEach((layer) => {
    if (layer.type === 'symbol' || stripKeywords.some((k) => layer.id.includes(k))) {
      map.removeLayer(layer.id);
    }
  });

  map.addSource('municipios', {
    type: 'geojson',
    data: res,
    promoteId: 'objectid',
  });

  map.addLayer({
    id: 'municipios-fill',
    type: 'fill',
    source: 'municipios',
    paint: {
      'fill-color': [
        'match', ['feature-state', 'result'],
        'correct', COLOR_SUCCESS,
        'incorrect', COLOR_ERROR,
        COLOR_NEUTRAL,
      ],
      'fill-opacity': [
        'match', ['feature-state', 'result'],
        'correct', 0.75,
        'incorrect', 0.75,
        0.08,
      ],
    },
  });

  map.addLayer({
    id: 'municipios-outline',
    type: 'line',
    source: 'municipios',
    paint: {
      'line-color': '#2c2c28',
      'line-width': 1,
      'line-opacity': 0.4,
    },
  });

  const bounds = computeBounds(res.features);
  map.fitBounds(bounds, { padding: 40, animate: false });

  map.on('click', (e) => handleGuess(e.point));
  map.on('mouseenter', 'municipios-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'municipios-fill', () => { map.getCanvas().style.cursor = ''; });

  queue = shuffle(res.features.map((f) => f.properties));
  currentIndex = 0;
  correctCount = 0;
  updateStats();
  showNextTarget();
}

init();

function buildShareText() {
  const pct = Math.round((correctCount / TOTAL_MUNICIPIOS) * 100);
  const grade = gradeFromPercent(pct);
  return `Saqué una ${grade} (${pct}%) reconociendo los pueblos de Puerto Rico en el mapa. ¿Puedes superarme?`;
}

shareBtn.addEventListener('click', async () => {
  const text = buildShareText();
  const url = window.location.href;

  if (navigator.share) {
    try {
      await navigator.share({ title: 'Pueblos de Puerto Rico', text, url });
      return;
    } catch (err) {
      // El usuario canceló o falló; caemos al menú de respaldo.
    }
  }

  let shareLinks = document.getElementById('share-links');
  if (!shareLinks) {
    shareLinks = document.createElement('div');
    shareLinks.id = 'share-links';
    shareLinks.className = 'share-menu';
    shareBtn.insertAdjacentElement('afterend', shareLinks);
  }

  const encodedText = encodeURIComponent(text);
  const encodedUrl = encodeURIComponent(url);
  shareLinks.innerHTML = `
    <a href="https://wa.me/?text=${encodedText}%20${encodedUrl}" target="_blank" rel="noopener">WhatsApp</a>
    <a href="https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}" target="_blank" rel="noopener">X / Twitter</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}" target="_blank" rel="noopener">Facebook</a>
    <a href="#" id="copy-link">Copiar enlace</a>
  `;
  document.getElementById('copy-link').addEventListener('click', async (e) => {
    e.preventDefault();
    await navigator.clipboard.writeText(`${text} ${url}`);
    e.target.textContent = '¡Copiado!';
  });
});

replayBtn.addEventListener('click', () => {
  window.location.reload();
});
