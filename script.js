/* CampoGeo V4.0 com logo integrada
   - Cria imagem/mapa em alta qualidade a partir do PDF
   - Salva offline no IndexedDB
   - GPS por cima do mapa controlado pelo app
   - Botão Localizar fixo
*/

const DB_NAME = "campogeo-v4-3-db";
const DB_VERSION = 1;
const MAP_STORE = "maps";
const ASSET_STORE = "assets";

const PDF_SOURCES = [
  {
    label: "PDF.js local",
    script: "./libs/pdf.min.js",
    worker: "./libs/pdf.worker.min.js",
    local: true,
  },
  {
    label: "PDF.js cdnjs",
    script: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    worker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  },
  {
    label: "PDF.js jsDelivr",
    script: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
    worker: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js",
  },
];

const $ = (selector) => document.querySelector(selector);

const ui = {
  homeScreen: $("#homeScreen"),
  mapScreen: $("#mapScreen"),
  pdfInput: $("#pdfInput"),
  refreshMapsBtn: $("#refreshMapsBtn"),
  resetAllBtn: $("#resetAllBtn"),
  clearCacheBtn: $("#clearCacheBtn"),
  mapList: $("#mapList"),
  emptyState: $("#emptyState"),

  connectionStatus: $("#connectionStatus"),
  engineStatus: $("#engineStatus"),
  gpsStatus: $("#gpsStatus"),

  currentMapName: $("#currentMapName"),
  pageInfo: $("#pageInfo"),
  backBtn: $("#backBtn"),
  mapWrapper: $("#mapWrapper"),
  mapStage: $("#mapStage"),
  mapImage: $("#mapImage"),
  fallbackCanvas: $("#fallbackCanvas"),
  pointsLayer: $("#pointsLayer"),
  gpsLayer: $("#gpsLayer"),
  locateBtn: $("#locateBtn"),

  progressOverlay: $("#progressOverlay"),
  progressTitle: $("#progressTitle"),
  progressFill: $("#progressFill"),
  progressText: $("#progressText"),
  cancelProgressBtn: $("#cancelProgressBtn"),
  gpsDebugBox: $("#gpsDebugBox"),
  toast: $("#toast"),
  splashScreen: $("#splashScreen"),
};

const canvasCtx = ui.fallbackCanvas.getContext("2d", { alpha: false });

let db = null;
let pdfJsReady = false;
let cachedPdfMainUrl = null;
let cachedPdfWorkerUrl = null;

let currentMap = null;
let currentImageUrl = null;

let zoom = 1;
let translate = { x: 0, y: 0 };
let displaySize = { width: 0, height: 0 };
let imageNaturalSize = { width: 0, height: 0 };

let isDragging = false;
let dragStart = { x: 0, y: 0 };
let translateStart = { x: 0, y: 0 };

let touchActive = false;
let touchMode = "none";
let touchStartPoint = { x: 0, y: 0 };
let touchStartTranslate = { x: 0, y: 0 };
let touchStartDistance = 0;
let touchStartZoom = 1;
let touchMoved = false;

let gpsWatchId = null;
let currentGps = null;
let currentGpsMap = null;
let lastLocateTapAt = 0;
let cancelRenderRequested = false;
let activeRenderTask = null;
let explicitGenerateAllowed = false;
const splashStartedAt = Date.now();


function hideSplashScreen() {
  if (!ui.splashScreen) return;
  document.body.classList.remove("app-loading");
  ui.splashScreen.classList.add("hidden");
  setTimeout(() => ui.splashScreen?.remove(), 420);
}

async function finishSplash() {
  const elapsed = Date.now() - splashStartedAt;
  const minTime = 1400;
  if (elapsed < minTime) {
    await new Promise((resolve) => setTimeout(resolve, minTime - elapsed));
  }
  hideSplashScreen();
}

function updateAppHeight() {
  const height = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight;
  document.documentElement.style.setProperty("--app-height", `${Math.round(height)}px`);
}

document.addEventListener("DOMContentLoaded", () => {
  updateAppHeight();
  hideProgress();
  bindAllButtonsSafely();
  init();
});

window.addEventListener("resize", updateAppHeight);
window.visualViewport?.addEventListener("resize", updateAppHeight);
window.visualViewport?.addEventListener("scroll", updateAppHeight);

async function init() {
  hideProgress();
  try {
    db = await openDatabase();
    setupEvents();
    updateConnectionStatus();
    updateEngineStatus(false, "Motor");
    updateGpsUi("stopped", "GPS parado.");
    await loadPdfJs();
    await renderMapList();
    cleanupOldV3Databases();
    registerServiceWorker();
    await finishSplash();
  } catch (error) {
    console.error(error);
    showToast("Erro ao iniciar app.");
    await finishSplash();
  }
}


function cleanupOldV3Databases() {
  // Remove bancos antigos para não aparecer PDF antigo.
  const oldDbs = ["gpf-mapas-v3-db", "gpf-mapas-v3-2-db", "gpf-mapas-v3-3-db", "gpf-mapas-v3-4-db", "gpf-mapas-v3-5-db", "gpf-mapas-v3-6-db", "gpf-mapas-v3-7-db", "gpf-mapas-v3-8-db", "gpf-mapas-v3-9-db"];
  for (const name of oldDbs) {
    try {
      indexedDB.deleteDatabase(name);
    } catch {}
  }
}

function setupEvents() {
  bindAllButtonsSafely();

  window.addEventListener("online", updateConnectionStatus);
  window.addEventListener("offline", updateConnectionStatus);
  window.addEventListener("resize", () => {
    updateAppHeight();
    if (currentMap) fitMapToScreen();
  });
}

function bindAllButtonsSafely() {
  // Liga os botões de forma resistente. Se algum listener antigo falhar,
  // o onclick do HTML e a delegação abaixo ainda funcionam.
  safeBind("pdfInput", "change", handlePdfImport);
  safeBind("refreshMapsBtn", "click", () => {
    flashButton("refreshMapsBtn");
    renderMapList();
    showToast("Atualizado.");
  });
  safeBind("resetAllBtn", "click", () => {
    flashButton("resetAllBtn");
    resetEverything();
  });
  safeBind("clearCacheBtn", "click", () => {
    flashButton("clearCacheBtn");
    clearCacheAndReload();
  });
  safeBind("backBtn", "click", async () => {
    document.body.classList.remove("map-open");
    updateAppHeight();
    ui.mapScreen.classList.remove("active");
    ui.homeScreen.classList.add("active");
    cleanupCurrentMap();
    await renderMapList();
  });
  safeBind("cancelProgressBtn", "click", cancelCurrentRender);
  safeBind("locateBtn", "click", () => {
    flashButton("locateBtn");
    handleLocateClick();
  });
  safeBind("locateBtn", "touchend", (event) => {
    event.preventDefault();
    event.stopPropagation();
    flashButton("locateBtn");
    handleLocateClick();
  }, { passive: false });

  // Gestos do mapa.
  const wrapper = document.getElementById("mapWrapper");
  if (wrapper && !wrapper.dataset.gpfGesturesBound) {
    wrapper.dataset.gpfGesturesBound = "1";
    wrapper.addEventListener("touchstart", handleTouchStart, { passive: false });
    wrapper.addEventListener("touchmove", handleTouchMove, { passive: false });
    wrapper.addEventListener("touchend", handleTouchEnd, { passive: false });
    wrapper.addEventListener("touchcancel", handleTouchEnd, { passive: false });
    wrapper.addEventListener("pointerdown", handlePointerDown);
    wrapper.addEventListener("pointermove", handlePointerMove);
    wrapper.addEventListener("pointerup", handlePointerUp);
    wrapper.addEventListener("pointercancel", handlePointerUp);
    wrapper.addEventListener("wheel", (event) => {
      event.preventDefault();
      setZoom(zoom + (event.deltaY < 0 ? 0.22 : -0.22), event.clientX, event.clientY);
    }, { passive: false });
  }

  // Delegação de emergência para botões criados dinamicamente.
  if (!document.body.dataset.gpfDelegated) {
    document.body.dataset.gpfDelegated = "1";
    document.addEventListener("click", handleGlobalButtonClick, true);
  }

  window.gpfApp = {
    refresh: () => {
      flashButton("refreshMapsBtn");
      renderMapList();
      showToast("Atualizado.");
    },
    reset: () => {
      flashButton("resetAllBtn");
      resetEverything();
    },
    clearCache: () => {
      flashButton("clearCacheBtn");
      clearCacheAndReload();
    },
    locate: () => {
      flashButton("locateBtn");
      handleLocateClick();
    },
  };
}

function safeBind(id, eventName, handler, options) {
  const el = document.getElementById(id);
  if (!el) return;

  const key = `gpf_${eventName}_bound`;
  if (el.dataset[key]) return;
  el.dataset[key] = "1";

  el.addEventListener(eventName, handler, options || false);
}

function handleGlobalButtonClick(event) {
  const target = event.target.closest?.("button");
  if (!target) return;

  const id = target.id || "";

  if (id === "refreshMapsBtn") {
    event.preventDefault();
    flashButton(id);
    renderMapList();
    showToast("Atualizado.");
    return;
  }

  if (id === "resetAllBtn") {
    event.preventDefault();
    flashButton(id);
    resetEverything();
    return;
  }

  if (id === "clearCacheBtn") {
    event.preventDefault();
    flashButton(id);
    clearCacheAndReload();
    return;
  }

  if (id === "locateBtn") {
    event.preventDefault();
    flashButton(id);
    handleLocateClick();
    return;
  }
}

function flashButton(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("clicked");
  setTimeout(() => el.classList.remove("clicked"), 350);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MAP_STORE)) {
        database.createObjectStore(MAP_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(ASSET_STORE)) {
        database.createObjectStore(ASSET_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(storeName, mode = "readonly") {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function put(storeName, value) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName, "readwrite").put(value);
    request.onsuccess = () => resolve(value);
    request.onerror = () => reject(request.error);
  });
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function getOne(storeName, key) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function deleteOne(storeName, key) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName, "readwrite").delete(key);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

async function loadPdfJs() {
  if (window.pdfjsLib) {
    preparePdfJs({ label: "PDF.js pronto", worker: cachedPdfWorkerUrl || PDF_SOURCES[0].worker });
    return true;
  }

  try {
    await loadScript(PDF_SOURCES[0].script);
    if (window.pdfjsLib) {
      preparePdfJs(PDF_SOURCES[0]);
      return true;
    }
  } catch {}

  const cached = await loadPdfJsFromIndexedDb();
  if (cached) return true;

  if (navigator.onLine) {
    for (const source of PDF_SOURCES.filter((item) => !item.local)) {
      const saved = await downloadAndCachePdfJs(source);
      if (saved) {
        const loaded = await loadPdfJsFromIndexedDb();
        if (loaded) return true;
      }

      try {
        await loadScript(source.script);
        if (window.pdfjsLib) {
          preparePdfJs(source);
          cachePdfJsInBackground(source);
          return true;
        }
      } catch {}
    }
  }

  updateEngineStatus(false, "Sem motor");
  return false;
}

function preparePdfJs(source) {
  pdfJsReady = true;
  pdfjsLib.GlobalWorkerOptions.workerSrc = source.worker;
  updateEngineStatus(true, source.label.replace("PDF.js ", ""));
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((script) => script.src === src || script.src.endsWith(src))) {
      if (window.pdfjsLib) return resolve(true);
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve(true);
    script.onerror = () => {
      script.remove();
      reject(new Error(`Falha ao carregar ${src}`));
    };
    document.head.appendChild(script);
  });
}

async function loadPdfJsFromIndexedDb() {
  try {
    const main = await getOne(ASSET_STORE, "pdfjs-main");
    const worker = await getOne(ASSET_STORE, "pdfjs-worker");

    if (!main?.code || !worker?.code) return false;

    if (cachedPdfMainUrl) URL.revokeObjectURL(cachedPdfMainUrl);
    if (cachedPdfWorkerUrl) URL.revokeObjectURL(cachedPdfWorkerUrl);

    cachedPdfMainUrl = URL.createObjectURL(new Blob([main.code], { type: "text/javascript" }));
    cachedPdfWorkerUrl = URL.createObjectURL(new Blob([worker.code], { type: "text/javascript" }));

    await loadScript(cachedPdfMainUrl);

    if (window.pdfjsLib) {
      preparePdfJs({ label: "PDF.js offline", worker: cachedPdfWorkerUrl });
      return true;
    }
  } catch (error) {
    console.warn("PDF.js offline falhou:", error);
  }

  return false;
}

async function downloadAndCachePdfJs(source) {
  try {
    const mainResponse = await fetch(source.script, { cache: "reload" });
    const workerResponse = await fetch(source.worker, { cache: "reload" });

    if (!mainResponse.ok || !workerResponse.ok) return false;

    await put(ASSET_STORE, {
      id: "pdfjs-main",
      code: await mainResponse.text(),
      url: source.script,
      source: source.label,
      savedAt: new Date().toISOString(),
    });

    await put(ASSET_STORE, {
      id: "pdfjs-worker",
      code: await workerResponse.text(),
      url: source.worker,
      source: source.label,
      savedAt: new Date().toISOString(),
    });

    return true;
  } catch (error) {
    console.warn("Falha salvando PDF.js:", error);
    return false;
  }
}

function cachePdfJsInBackground(source) {
  if (!navigator.onLine) return;
  setTimeout(() => downloadAndCachePdfJs(source).catch(() => null), 600);
}

async function prepareOfflineEngine() {
  showProgress("Preparando offline", "Baixando motor do mapa...", 20);
  const ok = await loadPdfJs();
  hideProgress();

  if (ok) showToast("Motor offline preparado.");
  else showToast("Não consegui preparar offline. Abra com internet.");
}

async function handlePdfImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    showToast("Escolha um PDF.");
    event.target.value = "";
    return;
  }

  try {
    const data = await file.arrayBuffer();

    const map = {
      id: randomId(),
      name: file.name,
      size: file.size,
      createdAt: new Date().toISOString(),
      data,
      georef: extractGeoPdfViewports(data),
      realMap: null,
    };

    await put(MAP_STORE, map);
    hideProgress();

    showToast("PDF adicionado. Agora toque em Gerar.");
    await renderMapList();
  } catch (error) {
    console.error(error);
    hideProgress();
    showToast(error.message || "Erro ao importar PDF.");
  } finally {
    event.target.value = "";
  }
}

async function renderMapList() {
  const maps = await getAll(MAP_STORE);
  maps.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  ui.emptyState.style.display = maps.length ? "none" : "grid";
  ui.mapList.innerHTML = "";

  for (const map of maps) {
    const card = document.createElement("article");
    card.className = "map-card";

    const geoBadge = map.georef?.views?.length
      ? `<span class="geo-badge">GeoPDF • GPS disponível</span>`
      : `<span class="geo-badge">PDF comum • sem GPS no mapa</span>`;

    const realBadge = map.realMap?.blob
      ? `<span class="real-badge">Mapa real salvo offline • ${map.realMap.width}×${map.realMap.height}px</span>`
      : `<span class="real-badge">Toque em Gerar ou Abrir para preparar</span>`;

    card.innerHTML = `
      <div>
        <strong>${escapeHtml(map.name)}</strong>
        <span>${formatBytes(map.size)} • ${formatDate(map.createdAt)}</span>
        ${geoBadge}
        ${realBadge}
      </div>
      <div class="card-actions">
        <button class="primary-button" data-action="open">Abrir mapa</button>
        <button class="ghost-button" data-action="prepare">${map.realMap?.blob ? "Regenerar" : "Gerar"}</button>
        <button class="danger-button" data-action="delete">Excluir</button>
      </div>
    `;

    card.querySelector('[data-action="open"]').addEventListener("click", () => openMap(map.id));
    card.querySelector('[data-action="prepare"]').addEventListener("click", () => prepareMapById(map.id));
    card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      const ok = confirm(`Excluir "${map.name}"?`);
      if (!ok) return;
      await deleteOne(MAP_STORE, map.id);
      await renderMapList();
      showToast("Mapa excluído.");
    });

    ui.mapList.appendChild(card);
  }
}

async function prepareMapById(mapId) {
  let map = await getOne(MAP_STORE, mapId);
  if (!map) return;

  if (!map.data) {
    showToast("Adicione um PDF primeiro.");
    return;
  }

  const ok = confirm("Gerar mapa real agora? Isso pode demorar alguns segundos.");
  if (!ok) return;

  try {
    cancelRenderRequested = false;
    showProgress("Gerando mapa real", "Preparando somente porque você apertou Gerar...", 12);
    explicitGenerateAllowed = true;
    map = await ensureRealMap(map, true);
    explicitGenerateAllowed = false;
    await put(MAP_STORE, map);
    hideProgress();
    await renderMapList();
    showToast("Mapa real preparado. Agora toque em Abrir.");
  } catch (error) {
    explicitGenerateAllowed = false;
    hideProgress();
    showToast(error.message || "Não consegui gerar mapa real.");
  }
}

async function ensureRealMap(map, force = false) {
  if (map.realMap?.blob && !force) return map;

  if (!explicitGenerateAllowed) {
    throw new Error("Geração bloqueada: toque em Gerar para preparar o mapa.");
  }

  cancelRenderRequested = false;

  const ok = await loadPdfJs();
  if (!ok) {
    throw new Error("Abra online uma vez para preparar o motor do mapa.");
  }

  const realMap = await renderPdfToRealMap(map.data);
  map.realMap = realMap;
  map.preparedAt = new Date().toISOString();
  return map;
}

async function renderPdfToRealMap(arrayBuffer) {
  const copy = arrayBuffer.slice(0);

  showProgress("Gerando mapa real", "Abrindo PDF...", 18);
  await nextFrame();

  const pdfDoc = await pdfjsLib.getDocument({ data: copy }).promise;
  if (cancelRenderRequested) throw new Error("Geração cancelada.");

  const page = await pdfDoc.getPage(1);
  const natural = page.getViewport({ scale: 1 });

  // V3.1: resolução segura para celular. Evita tela travada.
  const isMobile = window.matchMedia("(max-width: 720px)").matches;
  const maxSide = isMobile ? 2600 : 4200;
  const maxPixels = isMobile ? 5200000 : 11000000;

  let scale = Math.min(maxSide / natural.width, maxSide / natural.height);
  scale = Math.max(1.15, Math.min(scale, isMobile ? 2.7 : 4.2));

  let viewport = page.getViewport({ scale });

  while (viewport.width * viewport.height > maxPixels && scale > 0.85) {
    scale *= 0.82;
    viewport = page.getViewport({ scale });
  }

  const width = Math.max(1, Math.floor(viewport.width));
  const height = Math.max(1, Math.floor(viewport.height));

  showProgress("Gerando mapa real", `Renderizando seguro: ${width}×${height}px...`, 42);
  await nextFrame();

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const c = canvas.getContext("2d", { alpha: false });
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = "high";
  c.fillStyle = "#fff";
  c.fillRect(0, 0, canvas.width, canvas.height);

  const renderTask = page.render({ canvasContext: c, viewport });
  activeRenderTask = renderTask;

  await promiseWithTimeout(renderTask.promise, isMobile ? 25000 : 35000, () => {
    try { renderTask.cancel(); } catch {}
  });

  activeRenderTask = null;

  if (cancelRenderRequested) throw new Error("Geração cancelada.");

  showProgress("Salvando offline", "Salvando imagem leve do mapa...", 78);
  await nextFrame();

  // JPEG é muito mais leve que PNG em celulares e evita travar no IndexedDB.
  let blob = await canvasToBlob(canvas, "image/jpeg", 0.92);

  // Se por algum motivo JPEG não funcionar bem, tenta PNG.
  if (!blob || blob.size < 1000) {
    blob = await canvasToBlob(canvas, "image/png", 1);
  }

  showProgress("Finalizando", "Mapa real pronto.", 96);
  await nextFrame();

  return {
    blob,
    mime: blob.type || "image/jpeg",
    width: canvas.width,
    height: canvas.height,
    page: 1,
    scale,
    createdAt: new Date().toISOString(),
  };
}

function promiseWithTimeout(promise, ms, onTimeout) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        try { onTimeout?.(); } catch {}
        reject(new Error("Demorou demais para gerar o mapa. Tente novamente ou use um PDF menor."));
      }, ms);
    }),
  ]);
}

function cancelCurrentRender() {
  cancelRenderRequested = true;
  try { activeRenderTask?.cancel?.(); } catch {}
  activeRenderTask = null;
  hideProgress();
  showToast("Geração cancelada.");
}

function canvasToBlob(canvas, type = "image/png", quality = 1) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Não consegui salvar a imagem do mapa."));
      }, type, quality);
    } catch (error) {
      reject(error);
    }
  });
}

async function openMap(mapId) {
  try {
    cleanupCurrentMap();
    const map = await getOne(MAP_STORE, mapId);

    if (!map) {
      showToast("Mapa não encontrado.");
      return;
    }

    if (!map.realMap?.blob) {
      showToast("Esse PDF ainda não foi gerado. Toque em Gerar primeiro.");
      showGpsDebug("<strong>Não gerei nada.</strong><br>Volte e toque em Gerar quando quiser preparar o mapa.", "waiting");
      return;
    }

    currentMap = map;

    updateAppHeight();
    document.body.classList.add("map-open");
    ui.homeScreen.classList.remove("active");
    ui.mapScreen.classList.add("active");
    ui.currentMapName.textContent = currentMap.name;

    await nextFrame();
    await loadRealMapImage(currentMap);
    fitMapToScreen();
    updateGpsForCurrentMap(false);

    ui.pageInfo.textContent = currentMap.georef?.views?.length
      ? "Mapa Real • GPS disponível"
      : "Mapa Real • sem GeoPDF";

    showToast("Mapa aberto.");
  } catch (error) {
    console.error(error);
    hideProgress();
    showToast(error.message || "Erro ao abrir mapa.");
  }
}

async function loadRealMapImage(map) {
  if (currentImageUrl) URL.revokeObjectURL(currentImageUrl);
  currentImageUrl = URL.createObjectURL(map.realMap.blob);

  ui.mapImage.src = currentImageUrl;
  ui.mapImage.style.display = "block";
  ui.fallbackCanvas.style.display = "none";

  await new Promise((resolve, reject) => {
    ui.mapImage.onload = resolve;
    ui.mapImage.onerror = reject;
  });

  imageNaturalSize = {
    width: map.realMap.width,
    height: map.realMap.height,
  };

  displaySize = { ...imageNaturalSize };

  ui.mapImage.style.width = `${imageNaturalSize.width}px`;
  ui.mapImage.style.height = `${imageNaturalSize.height}px`;
  ui.mapStage.style.width = `${imageNaturalSize.width}px`;
  ui.mapStage.style.height = `${imageNaturalSize.height}px`;
  ui.pointsLayer.style.width = `${imageNaturalSize.width}px`;
  ui.pointsLayer.style.height = `${imageNaturalSize.height}px`;
  ui.gpsLayer.style.width = `${imageNaturalSize.width}px`;
  ui.gpsLayer.style.height = `${imageNaturalSize.height}px`;
}

function fitMapToScreen() {
  if (!currentMap || !imageNaturalSize.width) return;

  const wrapperWidth = Math.max(1, ui.mapWrapper.clientWidth);
  const wrapperHeight = Math.max(1, ui.mapWrapper.clientHeight);

  const scale = Math.min(wrapperWidth / imageNaturalSize.width, wrapperHeight / imageNaturalSize.height) * 0.98;
  zoom = Math.max(0.04, scale);

  translate = {
    x: (wrapperWidth - imageNaturalSize.width * zoom) / 2,
    y: (wrapperHeight - imageNaturalSize.height * zoom) / 2,
  };

  applyTransform();
}

function cleanupCurrentMap() {
  if (currentImageUrl) {
    URL.revokeObjectURL(currentImageUrl);
    currentImageUrl = null;
  }

  currentMap = null;
  currentGpsMap = null;
  ui.mapImage.removeAttribute("src");
  ui.gpsLayer.innerHTML = "";
  ui.pointsLayer.innerHTML = "";
  imageNaturalSize = { width: 0, height: 0 };
  displaySize = { width: 0, height: 0 };
  zoom = 1;
  translate = { x: 0, y: 0 };
}

function setZoom(value, centerClientX = null, centerClientY = null) {
  if (!currentMap) return;

  const oldZoom = zoom;
  const nextZoom = Math.min(10, Math.max(0.03, value));
  if (Math.abs(nextZoom - oldZoom) < 0.001) return;

  const rect = ui.mapWrapper.getBoundingClientRect();
  const centerX = centerClientX ?? rect.left + rect.width / 2;
  const centerY = centerClientY ?? rect.top + rect.height / 2;

  const localX = centerX - rect.left;
  const localY = centerY - rect.top;

  const mapX = (localX - translate.x) / oldZoom;
  const mapY = (localY - translate.y) / oldZoom;

  zoom = nextZoom;
  translate = {
    x: localX - mapX * zoom,
    y: localY - mapY * zoom,
  };

  applyTransform();
}

function applyTransform() {
  ui.mapStage.style.transform = `translate3d(${translate.x}px, ${translate.y}px, 0) scale(${zoom})`;
  updateGpsMarkerScale();
}

function handleTouchStart(event) {
  if (event.target.closest?.("#locateBtn")) return;
  if (!currentMap) return;
  event.preventDefault();
  event.stopPropagation();

  touchActive = true;
  const touches = getTouchPoints(event);

  if (touches.length >= 2) {
    touchMode = "pinch";
    touchStartDistance = distanceBetween(touches[0], touches[1]);
    touchStartZoom = zoom;
    touchMoved = false;
    return;
  }

  if (touches.length === 1) {
    touchMode = "pan";
    touchStartPoint = touches[0];
    touchStartTranslate = { ...translate };
    touchMoved = false;
  }
}

function handleTouchMove(event) {
  if (!currentMap || !touchActive) return;
  event.preventDefault();
  event.stopPropagation();

  const touches = getTouchPoints(event);

  if (touches.length >= 2) {
    const distance = distanceBetween(touches[0], touches[1]);
    const center = midpoint(touches[0], touches[1]);

    if (!touchStartDistance || touchStartDistance < 8) {
      touchStartDistance = distance;
      touchStartZoom = zoom;
      return;
    }

    touchMode = "pinch";
    touchMoved = true;
    setZoom(touchStartZoom * (distance / touchStartDistance), center.x, center.y);
    return;
  }

  if (touches.length === 1 && touchMode === "pan") {
    const point = touches[0];
    const dx = point.x - touchStartPoint.x;
    const dy = point.y - touchStartPoint.y;

    if (Math.hypot(dx, dy) > 4) touchMoved = true;

    translate = {
      x: touchStartTranslate.x + dx,
      y: touchStartTranslate.y + dy,
    };

    applyTransform();
  }
}

function handleTouchEnd(event) {
  if (!currentMap || !touchActive) return;
  event.preventDefault();
  event.stopPropagation();

  if (event.touches.length > 0) return;

  touchActive = false;
  touchMode = "none";
  touchMoved = false;
}

function getTouchPoints(event) {
  return [...event.touches].map((touch) => ({ x: touch.clientX, y: touch.clientY }));
}

function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function handlePointerDown(event) {
  if (!currentMap || event.pointerType === "touch") return;
  ui.mapWrapper.setPointerCapture(event.pointerId);
  isDragging = true;
  dragStart = { x: event.clientX, y: event.clientY };
  translateStart = { ...translate };
}

function handlePointerMove(event) {
  if (!currentMap || event.pointerType === "touch" || !isDragging) return;
  translate = {
    x: translateStart.x + event.clientX - dragStart.x,
    y: translateStart.y + event.clientY - dragStart.y,
  };
  applyTransform();
}

function handlePointerUp(event) {
  if (event.pointerType === "touch") return;
  isDragging = false;
}

async function handleLocateClick() {
  const now = Date.now();
  if (now - lastLocateTapAt < 650) return;
  lastLocateTapAt = now;

  if (!currentMap) {
    showToast("Abra um mapa primeiro.");
    return;
  }

  updateLocateButton("locating", "Localizando");
  showGpsDebug("<strong>Buscando GPS...</strong><br>Se aparecer permissão, toque em Permitir.", "waiting");
  updateGpsUi("waiting", "Buscando GPS...");

  try {
    const position = await getGpsPositionNow();
    setCurrentGps(position);

    if (gpsWatchId === null) {
      try {
        gpsWatchId = navigator.geolocation.watchPosition(
          (pos) => {
            setCurrentGps(pos);
            updateGpsForCurrentMap(false);
          },
          handleGpsError,
          { enableHighAccuracy: true, maximumAge: 0, timeout: 35000 }
        );
      } catch {}
    }

    updateGpsForCurrentMap(false);

    if (currentGpsMap?.inside) {
      centerOnGps();
      updateLocateButton("active", "Localizar");
      showGpsDebug(`<strong>Localizado no mapa.</strong><br>${formatLatLon(currentGps.lat, currentGps.lon)} • ±${Math.round(currentGps.accuracy || 0)} m`, "");
    } else if (!currentMap.georef?.views?.length) {
      updateLocateButton("outside", "Sem GeoPDF");
      showGpsDebug(`<strong>GPS pegou, mas este PDF não tem GeoPDF detectado.</strong><br>${formatLatLon(currentGps.lat, currentGps.lon)}`, "error");
    } else {
      updateLocateButton("outside", "Fora mapa");
      showGpsDebug(`<strong>GPS pegou, mas está fora do perímetro deste mapa.</strong><br>${formatLatLon(currentGps.lat, currentGps.lon)} • ±${Math.round(currentGps.accuracy || 0)} m`, "error");
    }
  } catch (error) {
    updateLocateButton("outside", "GPS erro");
    updateGpsUi("error", error.message || "Erro no GPS.");
    showGpsDebug(`<strong>GPS não ativou.</strong><br>${escapeHtml(error.message || "Erro no GPS.")}`, "error");
  }
}

function getGpsPositionNow() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Este navegador não tem suporte a GPS."));
      return;
    }

    if (!window.isSecureContext) {
      reject(new Error("GPS bloqueado: abra em HTTPS, como GitHub Pages."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      resolve,
      (error) => {
        const messages = {
          1: "Permissão negada. Ative a permissão de localização para este site.",
          2: "Não consegui obter localização. Confira se a localização do celular está ligada.",
          3: "Tempo esgotado. Tente ao ar livre e toque em Localizar novamente.",
        };
        reject(new Error(messages[error.code] || error.message || "Erro ao buscar GPS."));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 35000 }
    );
  });
}

function setCurrentGps(position) {
  currentGps = {
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    accuracy: position.coords.accuracy,
    altitude: position.coords.altitude,
    heading: position.coords.heading,
    speed: position.coords.speed,
    timestamp: position.timestamp,
  };
}

function handleGpsError(error) {
  const messages = {
    1: "Permissão de GPS negada.",
    2: "Não foi possível obter a posição.",
    3: "Tempo esgotado procurando GPS.",
  };
  updateGpsUi("error", messages[error.code] || "Erro no GPS.");
}

function updateGpsForCurrentMap(allowCenter = false) {
  if (!currentGps) {
    updateGpsUi("stopped", "GPS parado.");
    return;
  }

  if (!currentMap?.georef?.views?.length) {
    currentGpsMap = null;
    ui.gpsLayer.innerHTML = "";
    updateGpsUi("outside", "GPS ativo, mas PDF sem GeoPDF.");
    return;
  }

  const point = geoToMapPixel(currentGps.lat, currentGps.lon);
  if (!point?.inside) {
    currentGpsMap = null;
    ui.gpsLayer.innerHTML = "";
    updateGpsUi("outside", `Fora do mapa • ${formatLatLon(currentGps.lat, currentGps.lon)} • ±${Math.round(currentGps.accuracy || 0)} m`);
    return;
  }

  currentGpsMap = point;
  renderGpsMarker(point);
  updateGpsUi("inside", `Dentro do mapa • ${formatLatLon(currentGps.lat, currentGps.lon)} • ±${Math.round(currentGps.accuracy || 0)} m`);

  if (allowCenter) centerOnGps();
}

function geoToMapPixel(lat, lon) {
  if (!currentMap?.georef?.views?.length || !currentMap?.realMap) return null;

  const candidates = [];

  for (const view of currentMap.georef.views) {
    const uv = applyHomography(view.h, lon, lat);
    if (!uv) continue;

    const tolerance = 0.015;
    const inside = uv.u >= -tolerance && uv.u <= 1 + tolerance && uv.v >= -tolerance && uv.v <= 1 + tolerance;
    if (!inside) continue;

    const bbox = view.bbox;
    const pdfX = bbox[0] + uv.u * (bbox[2] - bbox[0]);
    const pdfY = bbox[1] + uv.v * (bbox[3] - bbox[1]);

    const mapX = pdfX * currentMap.realMap.scale;
    const pageHeightAtScale = view.pageHeight ? view.pageHeight * currentMap.realMap.scale : currentMap.realMap.height;
    const mapY = pageHeightAtScale - (pdfY * currentMap.realMap.scale);

    candidates.push({
      inside: true,
      x: mapX,
      y: mapY,
      view,
    });
  }

  if (!candidates.length) return { inside: false };
  candidates.sort((a, b) => b.view.area - a.view.area);
  return candidates[0];
}

function renderGpsMarker(point) {
  ui.gpsLayer.innerHTML = "";

  const marker = document.createElement("div");
  marker.className = "gps-user-marker";
  marker.style.left = `${point.x}px`;
  marker.style.top = `${point.y}px`;
  marker.innerHTML = `
    <div class="gps-accuracy-circle"></div>
    <div class="gps-pulse"></div>
    <div class="gps-dot-real"></div>
  `;

  ui.gpsLayer.appendChild(marker);
  updateGpsMarkerScale();
}

function updateGpsMarkerScale() {
  const marker = ui.gpsLayer.querySelector(".gps-user-marker");
  if (!marker) return;
  marker.style.transform = `scale(${1 / Math.max(zoom, 0.01)})`;
}

function centerOnGps() {
  if (!currentGpsMap?.inside) return;

  const isSmall = window.matchMedia("(max-width: 720px)").matches;
  const targetZoom = Math.max(zoom, isSmall ? 1.05 : 0.85);
  zoom = Math.min(targetZoom, isSmall ? 3.8 : 3.2);

  translate = {
    x: ui.mapWrapper.clientWidth / 2 - currentGpsMap.x * zoom,
    y: ui.mapWrapper.clientHeight / 2 - currentGpsMap.y * zoom,
  };

  applyTransform();
}

function extractGeoPdfViewports(arrayBuffer) {
  try {
    const bytes = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : arrayBuffer.slice(0);
    const text = new TextDecoder("iso-8859-1").decode(bytes);
    const views = [];

    const pageBox = findFirstPageMediaBox(text);

    const regex = /\/BBox\s*\[([^\]]+)\][\s\S]{0,3000}?\/Name\s*\(([\s\S]*?)\)[\s\S]{0,3000}?\/Measure\s*<<[\s\S]{0,3000}?\/Subtype\s*\/GEO[\s\S]{0,3000}?\/GPTS\s*\[([^\]]+)\][\s\S]{0,3000}?\/LPTS\s*\[([^\]]+)\]/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const view = buildGeoView({
        bbox: parseNumberList(match[1]),
        name: cleanPdfName(match[2]),
        gpts: parseNumberList(match[3]),
        lpts: parseNumberList(match[4]),
        pageBox,
      });
      if (view) views.push(view);
    }

    if (!views.length) {
      const regexNoName = /\/BBox\s*\[([^\]]+)\][\s\S]{0,4200}?\/Measure\s*<<[\s\S]{0,4200}?\/Subtype\s*\/GEO[\s\S]{0,4200}?\/GPTS\s*\[([^\]]+)\][\s\S]{0,4200}?\/LPTS\s*\[([^\]]+)\]/g;
      while ((match = regexNoName.exec(text)) !== null) {
        const view = buildGeoView({
          bbox: parseNumberList(match[1]),
          name: "GeoPDF",
          gpts: parseNumberList(match[2]),
          lpts: parseNumberList(match[3]),
          pageBox,
        });
        if (view) views.push(view);
      }
    }

    if (!views.length) return null;
    views.sort((a, b) => b.area - a.area);
    return { type: "geopdf", detectedAt: new Date().toISOString(), views };
  } catch (error) {
    console.warn("GeoPDF não detectado:", error);
    return null;
  }
}

function findFirstPageMediaBox(text) {
  const match = text.match(/\/MediaBox\s*\[([^\]]+)\]/);
  const values = match ? parseNumberList(match[1]) : [];
  if (values.length >= 4) return values.slice(0, 4);
  return null;
}

function buildGeoView({ bbox, name, gpts, lpts, pageBox }) {
  if (bbox.length < 4 || gpts.length < 8 || lpts.length < 8) return null;

  const src = [
    [gpts[1], gpts[0]],
    [gpts[3], gpts[2]],
    [gpts[5], gpts[4]],
    [gpts[7], gpts[6]],
  ];

  const dst = [
    [lpts[0], lpts[1]],
    [lpts[2], lpts[3]],
    [lpts[4], lpts[5]],
    [lpts[6], lpts[7]],
  ];

  const h = solveHomography(src, dst);
  if (!h) return null;

  const area = Math.abs((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]));
  const pageHeight = pageBox ? Math.abs(pageBox[3] - pageBox[1]) : null;

  return {
    name: name || "GeoPDF",
    page: 1,
    bbox: bbox.slice(0, 4),
    gpts: gpts.slice(0, 8),
    lpts: lpts.slice(0, 8),
    h,
    area,
    pageBox,
    pageHeight,
  };
}

function parseNumberList(value) {
  return (String(value).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
}

function cleanPdfName(value) {
  return String(value || "")
    .replaceAll("\u0000", "")
    .replace(/^þÿ/, "")
    .replace(/[^\wÀ-ÿ\s.-]/g, "")
    .trim();
}

function solveHomography(src, dst) {
  const matrix = [];

  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];

    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }

  const result = gaussianSolve(matrix);
  if (!result) return null;
  return [...result, 1];
}

function gaussianSolve(matrix) {
  const n = 8;
  const a = matrix.map((row) => row.slice());

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }

    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];

    const div = a[col][col];
    for (let j = col; j <= n; j++) a[col][j] /= div;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= n; j++) a[row][j] -= factor * a[col][j];
    }
  }

  return a.map((row) => row[n]);
}

function applyHomography(h, x, y) {
  const den = h[6] * x + h[7] * y + h[8];
  if (!Number.isFinite(den) || Math.abs(den) < 1e-12) return null;

  return {
    u: (h[0] * x + h[1] * y + h[2]) / den,
    v: (h[3] * x + h[4] * y + h[5]) / den,
  };
}

function updateConnectionStatus() {
  const online = navigator.onLine;
  ui.connectionStatus.classList.toggle("online", online);
  const value = ui.connectionStatus.querySelector("[data-status-value]");
  if (value) value.textContent = online ? "Online" : "Offline";
}

function updateEngineStatus(ready, text) {
  ui.engineStatus.classList.toggle("ready", ready);
  const value = ui.engineStatus.querySelector("[data-status-value]");
  const shortText = ready ? "Pronto" : "Padrão";
  if (value) value.textContent = shortText;
}

function updateGpsUi(state = "stopped", message = "") {
  ui.gpsStatus.classList.remove("active", "inside", "outside", "waiting", "error", "ready");

  if (state !== "stopped") {
    ui.gpsStatus.classList.add(state);
  }

  const labels = {
    stopped: "Parado",
    waiting: "Buscando",
    active: "Ativo",
    inside: "No mapa",
    outside: "Fora",
    error: "Erro",
  };

  const value = ui.gpsStatus.querySelector("[data-status-value]");
  if (value) value.textContent = labels[state] || "GPS";
}

function updateLocateButton(state = "", text = "Localizar") {
  ui.locateBtn.classList.remove("active", "locating", "outside");
  if (state) ui.locateBtn.classList.add(state);
  ui.locateBtn.textContent = text;
}

function showGpsDebug(message, type = "") {
  ui.gpsDebugBox.className = `gps-debug-box ${type}`;
  ui.gpsDebugBox.innerHTML = message;
  ui.gpsDebugBox.hidden = false;

  clearTimeout(showGpsDebug.timer);
  showGpsDebug.timer = setTimeout(() => {
    ui.gpsDebugBox.hidden = true;
  }, 7000);
}

function showProgress(title, text, percent = 0) {
  ui.progressOverlay.hidden = false;
  ui.progressOverlay.style.display = "grid";
  ui.progressOverlay.classList.add("show");
  ui.progressTitle.textContent = title;
  ui.progressText.textContent = text;
  ui.progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function hideProgress() {
  if (!ui.progressOverlay) return;
  ui.progressOverlay.classList.remove("show");
  ui.progressOverlay.hidden = true;
  ui.progressOverlay.style.display = "none";
  ui.progressFill.style.width = "0%";
  ui.progressTitle.textContent = "Gerando mapa real...";
  ui.progressText.textContent = "Aguarde.";
}

async function clearCacheAndReload() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }

    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }

    showToast("Cache limpo. Recarregando...");
    setTimeout(() => location.reload(), 900);
  } catch (error) {
    location.reload();
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.warn(error));
  });
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

document.addEventListener("gesturestart", (event) => {
  if (document.body.classList.contains("map-open")) event.preventDefault();
}, { passive: false });

document.addEventListener("gesturechange", (event) => {
  if (document.body.classList.contains("map-open")) event.preventDefault();
}, { passive: false });

document.addEventListener("gestureend", (event) => {
  if (document.body.classList.contains("map-open")) event.preventDefault();
}, { passive: false });

function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatLatLon(lat, lon) {
  return `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => ui.toast.classList.remove("show"), 2600);
}
