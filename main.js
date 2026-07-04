/* Juego build-free: usa el objeto global `maplibregl` cargado desde el CDN. */
(function () {
  'use strict';

  var GEOJSON_URL = './municipios.geojson';
  var TOTAL_MUNICIPIOS = 78;
  var FEEDBACK_DELAY_MS = 900;

  var COLOR_SUCCESS = '#2f6b4f';
  var COLOR_ERROR = '#ba1a1a';
  var COLOR_NEUTRAL = '#8f9a94';

  var targetNameEl = document.getElementById('target-name');
  var progressFillEl = document.getElementById('progress-fill');
  var progressFractionEl = document.getElementById('progress-fraction');
  var scorePctEl = document.getElementById('score-pct');
  var feedbackEl = document.getElementById('feedback');
  var resultModalEl = document.getElementById('result-modal');
  var resultGradeEl = document.getElementById('result-grade');
  var resultPctEl = document.getElementById('result-pct');
  var resultDetailEl = document.getElementById('result-detail');
  var shareBtn = document.getElementById('share-btn');
  var replayBtn = document.getElementById('replay-btn');

  if (typeof maplibregl === 'undefined') {
    targetNameEl.textContent = 'No se pudo cargar el mapa.';
    feedbackEl.textContent = 'Revisa tu conexión a internet e intenta de nuevo.';
    feedbackEl.className = 'feedback incorrect';
    return;
  }

  function shuffle(array) {
    var copy = array.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function computeBounds(features) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function walk(coords) {
      if (typeof coords[0] === 'number') {
        var x = coords[0], y = coords[1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      } else {
        coords.forEach(walk);
      }
    }
    features.forEach(function (f) { walk(f.geometry.coordinates); });
    return [[minX, minY], [maxX, maxY]];
  }

  function gradeFromPercent(pct) {
    if (pct >= 90) return 'A';
    if (pct >= 80) return 'B';
    if (pct >= 70) return 'C';
    if (pct >= 60) return 'D';
    return 'F';
  }

  var map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    center: [-66.45, 18.2],
    zoom: 8,
    minZoom: 7,
    maxZoom: 14,
    pitch: 0
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

  var queue = [];
  var currentIndex = 0;
  var correctCount = 0;
  var accepting = false;
  var gameEnded = false;

  function updateStats() {
    var answered = currentIndex;
    progressFillEl.style.width = (answered / TOTAL_MUNICIPIOS) * 100 + '%';
    progressFractionEl.textContent = answered + ' / ' + TOTAL_MUNICIPIOS;
    var pct = answered > 0 ? Math.round((correctCount / answered) * 100) : 0;
    scorePctEl.textContent = pct + '%';
  }

  function showNextTarget() {
    if (currentIndex >= queue.length) {
      endGame();
      return;
    }
    var target = queue[currentIndex];
    targetNameEl.textContent = target.municipio;
    feedbackEl.textContent = '';
    feedbackEl.className = 'feedback';
    accepting = true;
  }

  function endGame() {
    gameEnded = true;
    targetNameEl.textContent = '¡Completado!';
    var pct = Math.round((correctCount / TOTAL_MUNICIPIOS) * 100);
    var grade = gradeFromPercent(pct);
    resultGradeEl.textContent = grade;
    resultPctEl.textContent = pct + '%';
    resultDetailEl.textContent = 'Acertaste ' + correctCount + ' de ' + TOTAL_MUNICIPIOS + ' municipios.';
    resultModalEl.classList.remove('hidden');
  }

  function handleGuess(point) {
    if (!accepting || gameEnded) return;
    accepting = false;

    var target = queue[currentIndex];
    var features = map.queryRenderedFeatures(point, { layers: ['municipios-fill'] });
    var clickedName = features.length > 0 ? features[0].properties.municipio : null;
    var isCorrect = clickedName === target.municipio;

    map.setFeatureState(
      { source: 'municipios', id: target.objectid },
      { result: isCorrect ? 'correct' : 'incorrect' }
    );

    if (isCorrect) {
      correctCount += 1;
      feedbackEl.textContent = '¡Correcto!';
      feedbackEl.className = 'feedback correct';
    } else {
      feedbackEl.textContent = 'Incorrecto. Era ' + target.municipio + '.';
      feedbackEl.className = 'feedback incorrect';
    }

    currentIndex += 1;
    updateStats();

    setTimeout(showNextTarget, FEEDBACK_DELAY_MS);
  }

  function setupGame(data) {
    map.addSource('municipios', {
      type: 'geojson',
      data: data,
      promoteId: 'objectid'
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
          COLOR_NEUTRAL
        ],
        'fill-opacity': [
          'match', ['feature-state', 'result'],
          'correct', 0.75,
          'incorrect', 0.75,
          0.08
        ]
      }
    });

    map.addLayer({
      id: 'municipios-outline',
      type: 'line',
      source: 'municipios',
      paint: {
        'line-color': '#2c2c28',
        'line-width': 1,
        'line-opacity': 0.4
      }
    });

    map.fitBounds(computeBounds(data.features), { padding: 40, animate: false });

    map.on('click', function (e) { handleGuess(e.point); });
    map.on('mouseenter', 'municipios-fill', function () { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'municipios-fill', function () { map.getCanvas().style.cursor = ''; });

    queue = shuffle(data.features.map(function (f) { return f.properties; }));
    currentIndex = 0;
    correctCount = 0;
    updateStats();
    showNextTarget();
  }

  function init() {
    Promise.all([
      fetch(GEOJSON_URL).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }),
      new Promise(function (resolve) { map.on('load', resolve); })
    ]).then(function (results) {
      var data = results[0];

      var layers = map.getStyle().layers;
      var stripKeywords = ['road', 'bridge', 'tunnel', 'path', 'place-city', 'place-town', 'place-village', 'place-hamlet', 'poi'];
      layers.forEach(function (layer) {
        if (layer.type === 'symbol' || stripKeywords.some(function (k) { return layer.id.indexOf(k) !== -1; })) {
          map.removeLayer(layer.id);
        }
      });

      setupGame(data);
    }).catch(function (err) {
      targetNameEl.textContent = 'No se pudieron cargar los municipios.';
      feedbackEl.textContent = 'Error: ' + err.message;
      feedbackEl.className = 'feedback incorrect';
    });
  }

  init();

  function buildShareText() {
    var pct = Math.round((correctCount / TOTAL_MUNICIPIOS) * 100);
    var grade = gradeFromPercent(pct);
    return 'Saqué una ' + grade + ' (' + pct + '%) reconociendo los pueblos de Puerto Rico en el mapa. ¿Puedes superarme?';
  }

  shareBtn.addEventListener('click', function () {
    var text = buildShareText();
    var url = window.location.href;

    if (navigator.share) {
      navigator.share({ title: 'Pueblos de Puerto Rico', text: text, url: url }).catch(function () {
        showShareLinks(text, url);
      });
      return;
    }
    showShareLinks(text, url);
  });

  function showShareLinks(text, url) {
    var shareLinks = document.getElementById('share-links');
    if (!shareLinks) {
      shareLinks = document.createElement('div');
      shareLinks.id = 'share-links';
      shareLinks.className = 'share-menu';
      shareBtn.insertAdjacentElement('afterend', shareLinks);
    }

    var encodedText = encodeURIComponent(text);
    var encodedUrl = encodeURIComponent(url);
    shareLinks.innerHTML =
      '<a href="https://wa.me/?text=' + encodedText + '%20' + encodedUrl + '" target="_blank" rel="noopener">WhatsApp</a>' +
      '<a href="https://twitter.com/intent/tweet?text=' + encodedText + '&url=' + encodedUrl + '" target="_blank" rel="noopener">X / Twitter</a>' +
      '<a href="https://www.facebook.com/sharer/sharer.php?u=' + encodedUrl + '" target="_blank" rel="noopener">Facebook</a>' +
      '<a href="#" id="copy-link">Copiar enlace</a>';

    document.getElementById('copy-link').addEventListener('click', function (e) {
      e.preventDefault();
      var self = this;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text + ' ' + url).then(function () {
          self.textContent = '¡Copiado!';
        });
      }
    });
  }

  replayBtn.addEventListener('click', function () {
    window.location.reload();
  });
})();
