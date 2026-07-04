/* Juego build-free: usa el objeto global `maplibregl` cargado desde el CDN. */
(function () {
  'use strict';

  var GEOJSON_URL = './municipios.geojson';
  var FEEDBACK_DELAY_MS = 900;
  var MIN_LOADING_MS = 1200;

  var COLOR_SUCCESS = '#2f6b4f';
  var COLOR_ERROR = '#ba1a1a';
  var COLOR_NEUTRAL = '#8f9a94';
  var COLOR_PENDING = '#d4a843';

  var loadingOverlayEl = document.getElementById('loading-overlay');
  var loadingFillEl = document.getElementById('loading-fill');
  var loadingPctEl = document.getElementById('loading-pct');
  var introModalEl = document.getElementById('intro-modal');
  var modeQuickBtn = document.getElementById('mode-quick-btn');
  var modeFullBtn = document.getElementById('mode-full-btn');

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
  var chooseBtn = document.getElementById('choose-btn');
  var newsletterBtn = document.getElementById('newsletter-btn');
  var newsletterNoteEl = document.getElementById('newsletter-note');

  if (typeof maplibregl === 'undefined') {
    loadingOverlayEl.classList.add('hidden');
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

  // Usa solo el anillo con más vértices (la masa terrestre principal) para
  // que islas lejanas de un mismo municipio (p. ej. Mona en Mayagüez) no
  // distorsionen el encuadre al revelar la respuesta correcta.
  function computeMainRingBounds(feature) {
    var polygons = feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [feature.geometry.coordinates];
    var mainRing = null;
    var mainRingLength = -1;
    polygons.forEach(function (poly) {
      var outerRing = poly[0];
      if (outerRing.length > mainRingLength) {
        mainRingLength = outerRing.length;
        mainRing = outerRing;
      }
    });

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    mainRing.forEach(function (c) {
      if (c[0] < minX) minX = c[0];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[1] > maxY) maxY = c[1];
    });
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

  var allMunicipios = [];
  var queue = [];
  var total = 78;
  var currentIndex = 0;
  var correctCount = 0;
  var accepting = false;
  var gameEnded = false;
  var overallBounds = null;
  var zoomedAway = false;
  var pendingId = null;
  var pendingName = null;

  function updateStats() {
    var answered = currentIndex;
    progressFillEl.style.width = (answered / total) * 100 + '%';
    progressFractionEl.textContent = answered + ' / ' + total;
    var pct = answered > 0 ? Math.round((correctCount / answered) * 100) : 0;
    scorePctEl.textContent = pct + '%';
  }

  function clearPending() {
    if (pendingId !== null) {
      map.setFeatureState({ source: 'municipios', id: pendingId }, { selected: false });
      pendingId = null;
      pendingName = null;
    }
    chooseBtn.classList.add('hidden');
  }

  function showNextTarget() {
    clearPending();

    if (currentIndex >= queue.length) {
      endGame();
      return;
    }

    var target = queue[currentIndex];
    targetNameEl.textContent = target.properties.municipio;
    feedbackEl.textContent = '';
    feedbackEl.className = 'feedback';
    accepting = true;

    if (zoomedAway) {
      zoomedAway = false;
      map.fitBounds(overallBounds, { padding: 40, duration: 600 });
    }
  }

  function endGame() {
    gameEnded = true;
    targetNameEl.textContent = '¡Completado!';
    var pct = Math.round((correctCount / total) * 100);
    var grade = gradeFromPercent(pct);
    resultGradeEl.textContent = grade;
    resultPctEl.textContent = pct + '%';
    resultDetailEl.textContent = 'Acertaste ' + correctCount + ' de ' + total + ' municipios.';
    resultModalEl.classList.remove('hidden');
  }

  // Primer toque: solo resalta el municipio tocado (evita selecciones accidentales).
  function handleMapClick(point) {
    if (!accepting || gameEnded) return;

    var features = map.queryRenderedFeatures(point, { layers: ['municipios-fill'] });
    if (features.length === 0) return;

    var clickedId = features[0].id;
    if (clickedId === pendingId) return;

    if (pendingId !== null) {
      map.setFeatureState({ source: 'municipios', id: pendingId }, { selected: false });
    }
    pendingId = clickedId;
    pendingName = features[0].properties.municipio;
    map.setFeatureState({ source: 'municipios', id: pendingId }, { selected: true });

    feedbackEl.textContent = 'Tocaste ' + pendingName + '. Confirma tu selección.';
    feedbackEl.className = 'feedback pending';
    chooseBtn.classList.remove('hidden');
  }

  // Botón "Escoger": aquí se confirma y califica la selección.
  function confirmChoice() {
    if (!accepting || gameEnded || pendingId === null) return;
    accepting = false;

    var target = queue[currentIndex];
    var isCorrect = pendingName === target.properties.municipio;

    map.setFeatureState({ source: 'municipios', id: pendingId }, { selected: false });
    pendingId = null;
    pendingName = null;
    chooseBtn.classList.add('hidden');

    map.setFeatureState(
      { source: 'municipios', id: target.properties.objectid },
      { result: isCorrect ? 'correct' : 'incorrect' }
    );

    var delay = FEEDBACK_DELAY_MS;

    if (isCorrect) {
      correctCount += 1;
      feedbackEl.textContent = '¡Correcto!';
      feedbackEl.className = 'feedback correct';
    } else {
      feedbackEl.textContent = 'Incorrecto.';
      feedbackEl.className = 'feedback incorrect';
      map.fitBounds(computeMainRingBounds(target), { padding: 80, maxZoom: 12, duration: 900 });
      zoomedAway = true;
      delay = 2200;
    }

    currentIndex += 1;
    updateStats();

    setTimeout(showNextTarget, delay);
  }

  function setupMap(data) {
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
          'case',
          ['==', ['feature-state', 'result'], 'correct'], COLOR_SUCCESS,
          ['==', ['feature-state', 'result'], 'incorrect'], COLOR_ERROR,
          ['==', ['feature-state', 'selected'], true], COLOR_PENDING,
          COLOR_NEUTRAL
        ],
        'fill-opacity': [
          'case',
          ['==', ['feature-state', 'result'], 'correct'], 0.75,
          ['==', ['feature-state', 'result'], 'incorrect'], 0.75,
          ['==', ['feature-state', 'selected'], true], 0.6,
          0.08
        ]
      }
    });

    map.addLayer({
      id: 'municipios-outline',
      type: 'line',
      source: 'municipios',
      paint: {
        'line-color': [
          'case',
          ['==', ['feature-state', 'selected'], true], COLOR_PENDING,
          '#2c2c28'
        ],
        'line-width': [
          'case',
          ['==', ['feature-state', 'selected'], true], 2.5,
          1
        ],
        'line-opacity': [
          'case',
          ['==', ['feature-state', 'selected'], true], 1,
          0.4
        ]
      }
    });

    map.addLayer({
      id: 'municipios-labels',
      type: 'symbol',
      source: 'municipios',
      layout: {
        'text-field': ['get', 'municipio'],
        'text-size': 10,
        'text-max-width': 8
      },
      paint: {
        'text-color': '#1c1c18',
        'text-halo-color': '#f2ede4',
        'text-halo-width': 1.2,
        'text-opacity': [
          'case',
          ['==', ['feature-state', 'result'], 'correct'], 1,
          ['==', ['feature-state', 'result'], 'incorrect'], 1,
          0
        ]
      }
    });

    overallBounds = computeBounds(data.features);
    map.fitBounds(overallBounds, { padding: 40, animate: false });

    map.on('click', function (e) { handleMapClick(e.point); });
    map.on('mouseenter', 'municipios-fill', function () { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'municipios-fill', function () { map.getCanvas().style.cursor = ''; });

    allMunicipios = data.features;
  }

  function startGame(chosenTotal) {
    total = chosenTotal;
    queue = shuffle(allMunicipios).slice(0, total);
    currentIndex = 0;
    correctCount = 0;
    gameEnded = false;
    updateStats();
    showNextTarget();
    introModalEl.classList.add('hidden');
  }

  function animateLoading(realLoadPromise) {
    var progress = 0;
    var capBeforeReady = 90;
    var startedAt = Date.now();

    var interval = setInterval(function () {
      if (progress < capBeforeReady) {
        progress = Math.min(capBeforeReady, progress + 4);
        loadingFillEl.style.width = progress + '%';
        loadingPctEl.textContent = progress + '%';
      }
    }, 100);

    realLoadPromise.then(function () {
      var elapsed = Date.now() - startedAt;
      var remaining = Math.max(0, MIN_LOADING_MS - elapsed);
      setTimeout(function () {
        clearInterval(interval);
        loadingFillEl.style.width = '100%';
        loadingPctEl.textContent = '100%';
        setTimeout(function () {
          loadingOverlayEl.classList.add('fade-out');
          setTimeout(function () {
            loadingOverlayEl.classList.add('hidden');
            introModalEl.classList.remove('hidden');
          }, 400);
        }, 200);
      }, remaining);
    }).catch(function (err) {
      clearInterval(interval);
      loadingOverlayEl.classList.add('hidden');
      targetNameEl.textContent = 'No se pudieron cargar los municipios.';
      feedbackEl.textContent = 'Error: ' + err.message;
      feedbackEl.className = 'feedback incorrect';
    });
  }

  function init() {
    var loadPromise = Promise.all([
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

      setupMap(data);
    });

    animateLoading(loadPromise);
  }

  init();

  modeQuickBtn.addEventListener('click', function () {
    startGame(parseInt(modeQuickBtn.getAttribute('data-total'), 10));
  });

  modeFullBtn.addEventListener('click', function () {
    startGame(parseInt(modeFullBtn.getAttribute('data-total'), 10));
  });

  chooseBtn.addEventListener('click', confirmChoice);

  newsletterBtn.addEventListener('click', function () {
    newsletterNoteEl.classList.remove('hidden');
  });

  function buildShareText() {
    var pct = Math.round((correctCount / total) * 100);
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

  var instagramBtn = document.getElementById('instagram-btn');
  var instagramNoteEl = document.getElementById('instagram-note');

  function copyToClipboard(text) {
    if (navigator.clipboard) {
      return navigator.clipboard.writeText(text);
    }
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try { document.execCommand('copy'); } catch (e) { /* ignora si no es compatible */ }
    document.body.removeChild(textarea);
    return Promise.resolve();
  }

  instagramBtn.addEventListener('click', function () {
    var text = buildShareText();
    var url = window.location.href;
    var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    copyToClipboard(text + ' ' + url).then(function () {
      instagramNoteEl.classList.remove('hidden');
    });

    if (isMobile) {
      window.location.href = 'instagram://story-camera';
      setTimeout(function () {
        if (!document.hidden) {
          window.open('https://www.instagram.com/', '_blank');
        }
      }, 800);
    } else {
      window.open('https://www.instagram.com/', '_blank');
    }
  });

  replayBtn.addEventListener('click', function () {
    window.location.reload();
  });
})();
