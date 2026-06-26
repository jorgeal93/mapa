/* GPF Mapas V1.8 Mobile Estável
   Refeito para celular:
   - PDF.js com fallback nativo
   - Canvas com limite seguro para não sumir no iPhone/Android
   - Zoom com dois dedos dentro do mapa
   - GPS em GeoPDF quando detectado
*/

const DB_NAME = "gpf-mapas-db";
const DB_VERSION = 1;
const MAP_STORE = "maps";
const POINT_STORE = "points";

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
  clearCacheBtn: $("#clearCacheBtn"),
  mapList: $("#mapList"),
  emptyState: $("#emptyState"),
  connectionStatus: $("#connectionStatus"),
  pdfStatus: $("#pdfStatus"),
  gpsStatus: $("#gpsStatus"),
  toast: $("#toast"),

  currentMapName: $("#currentMapName"),
  pageInfo: $("#pageInfo"),
  backBtn: $("#backBtn"),
  deleteCurrentMapBtn: $("#deleteCurrentMapBtn"),
  prevPageBtn: $("#prevPageBtn"),
  nextPageBtn: $("#nextPageBtn"),
  zoomOutBtn: $("#zoomOutBtn"),
  zoomInBtn: $("#zoomInBtn"),
  zoomLabel: $("#zoomLabel"),
  resetViewBtn: $("#resetViewBtn"),
  qualitySelect: $("#qualitySelect"),
  locateBtn: $("#locateBtn"),
  newPointBtn: $("#newPointBtn"),
  gpsBtn: $("#gpsBtn"),
  centerGpsBtn: $("#centerGpsBtn"),
  saveGpsPointBtn: $("#saveGpsPointBtn"),
  gpsInfo: $("#gpsInfo"),
  viewerNote: $("#viewerNote"),
  exportPointsBtn: $("#exportPointsBtn"),

  mapWrapper: $("#mapWrapper"),
  mapStage: $("#mapStage"),
  canvas: $("#pdfCanvas"),
  svgLayer: $("#svgLayer"),
  pointsLayer: $("#pointsLayer"),
  gpsLayer: $("#gpsLayer"),
  nativePdfFrame: $("#nativePdfFrame"),

  pointModal: $("#pointModal"),
  pointForm: $("#pointForm"),
  pointName: $("#pointName"),
  pointArea: $("#pointArea"),
  pointNote: $("#pointNote"),
  pointsList: $("#pointsList"),
  emptyPointsState: $("#emptyPointsState"),
};

const ctx = ui.canvas.getContext("2d", { alpha: false });

let db = null;
let pdfJsReady = false;
let pdfSourceLabel = "Nativo";

let currentMap = null;
let pdfDoc = null;
let pageNum = 1;
let renderTask = null;
let viewerMode = "none";
let nativeUrl = null;

let currentPdfViewport = null;
let displaySize = { width: 0, height: 0 };
let renderQualityZoom = 1;
let renderTimer = null;

let zoom = 1;
let translate = { x: 0, y: 0 };
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let translateStart = { x: 0, y: 0 };
let pendingPoint = null;

let touchActive = false;
let touchMode = "none";
let touchStartPoint = { x: 0, y: 0 };
let touchLastPoint = { x: 0, y: 0 };
let touchStartTranslate = { x: 0, y: 0 };
let touchStartDistance = 0;
let touchStartZoom = 1;
let touchMoved = false;

let gpsWatchId = null;
let currentGps = null;
let currentGpsCanvas = null;
let gpsAutoCentered = false;

init();

async function init() {
  try {
    db = await openDatabase();
    setupEvents();
    updateConnectionStatus();
    updateGpsUi("stopped", "GPS desligado.");
    await loadPdfJs();
    await renderMapList();
    registerServiceWorker();
  } catch (error) {
    console.error(error);
    showToast("Erro ao iniciar o app.");
  }
}

async function loadPdfJs() {
  if (window.pdfjsLib) {
    preparePdfJs(PDF_SOURCES[0]);
    return true;
  }

  for (const source of PDF_SOURCES) {
    if (source.local) {
      try {
        await loadScript(source.script);
        if (window.pdfjsLib) {
          preparePdfJs(source);
          return true;
        }
      } catch {}
      continue;
    }

    if (!navigator.onLine) continue;

    try {
      await loadScript(source.script);
      if (window.pdfjsLib) {
        preparePdfJs(source);
        return true;
      }
    } catch {}
  }

  pdfJsReady = false;
  pdfSourceLabel = "Nativo";
  ui.pdfStatus.classList.remove("ready");
  ui.pdfStatus.querySelector("span:last-child").textContent = "Nativo";
  return false;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((script) => script.src.endsWith(src) || script.src === src)) {
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

function preparePdfJs(source) {
  pdfJsReady = true;
  pdfSourceLabel = source.label;
  pdfjsLib.GlobalWorkerOptions.workerSrc = source.worker;
  ui.pdfStatus.classList.add("ready");
  ui.pdfStatus.querySelector("span:last-child").textContent = source.label.replace("PDF.js ", "");
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MAP_STORE)) {
        database.createObjectStore(MAP_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(POINT_STORE)) {
        const store = database.createObjectStore(POINT_STORE, { keyPath: "id" });
        store.createIndex("mapId", "mapId", { unique: false });
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

function getPointsByMap(mapId) {
  return new Promise((resolve, reject) => {
    const index = tx(POINT_STORE).index("mapId");
    const request = index.getAll(mapId);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function deletePointsByMap(mapId) {
  const points = await getPointsByMap(mapId);
  await Promise.all(points.map((point) => deleteOne(POINT_STORE, point.id)));
}

function setupEvents() {
  ui.pdfInput.addEventListener("change", handlePdfImport);
  ui.refreshMapsBtn.addEventListener("click", renderMapList);
  ui.clearCacheBtn.addEventListener("click", clearCacheAndReload);

  ui.backBtn.addEventListener("click", async () => {
    document.body.classList.remove("map-open", "simple-map");
    ui.mapScreen.classList.remove("active");
    ui.homeScreen.classList.add("active");
    cleanupMap();
    await renderMapList();
  });

  ui.deleteCurrentMapBtn.addEventListener("click", async () => {
    if (!currentMap) return;
    const ok = confirm(`Excluir o mapa "${currentMap.name}" e os pontos dele?`);
    if (!ok) return;
    await deletePointsByMap(currentMap.id);
    await deleteOne(MAP_STORE, currentMap.id);
    showToast("Mapa excluído.");
    ui.backBtn.click();
  });

  ui.prevPageBtn.addEventListener("click", async () => {
    if (viewerMode !== "pdfjs" || !pdfDoc || pageNum <= 1) return;
    pageNum--;
    await renderCurrentPage({ fitView: true, forceQuality: true });
  });

  ui.nextPageBtn.addEventListener("click", async () => {
    if (viewerMode !== "pdfjs" || !pdfDoc || pageNum >= pdfDoc.numPages) return;
    pageNum++;
    await renderCurrentPage({ fitView: true, forceQuality: true });
  });

  ui.zoomOutBtn.addEventListener("click", () => setZoom(zoom - 0.25));
  ui.zoomInBtn.addEventListener("click", () => setZoom(zoom + 0.25));
  ui.resetViewBtn.addEventListener("click", () => viewerMode === "pdfjs" ? resetView() : showToast("No modo nativo, use o zoom do celular."));
  ui.qualitySelect.addEventListener("change", () => viewerMode === "pdfjs" && renderCurrentPage({ fitView: false, forceQuality: true }));

  ui.newPointBtn.addEventListener("click", () => {
    if (!currentMap) return;
    if (viewerMode !== "pdfjs") {
      showToast("Ponto preso no mapa precisa do modo PDF.js.");
      return;
    }
    pendingPoint = { waiting: true };
    showToast("Toque no local do mapa para criar o ponto.");
  });

  ui.locateBtn?.addEventListener("click", handleLocateButton);
  ui.gpsBtn.addEventListener("click", toggleGpsTracking);
  ui.centerGpsBtn.addEventListener("click", centerOnCurrentGps);
  ui.saveGpsPointBtn.addEventListener("click", createPointFromGps);
  ui.exportPointsBtn.addEventListener("click", exportCurrentPointsCsv);

  ui.pointForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await savePendingPoint();
  });

  ui.mapWrapper.addEventListener("touchstart", handleTouchStart, { passive: false });
  ui.mapWrapper.addEventListener("touchmove", handleTouchMove, { passive: false });
  ui.mapWrapper.addEventListener("touchend", handleTouchEnd, { passive: false });
  ui.mapWrapper.addEventListener("touchcancel", handleTouchEnd, { passive: false });

  ui.mapWrapper.addEventListener("pointerdown", handlePointerDown);
  ui.mapWrapper.addEventListener("pointermove", handlePointerMove);
  ui.mapWrapper.addEventListener("pointerup", handlePointerUp);
  ui.mapWrapper.addEventListener("pointercancel", handlePointerUp);
  ui.mapWrapper.addEventListener("dblclick", handleDoubleClick);

  ui.mapWrapper.addEventListener("wheel", (event) => {
    if (viewerMode !== "pdfjs") return;
    event.preventDefault();
    setZoom(zoom + (event.deltaY < 0 ? 0.18 : -0.18), event.clientX, event.clientY);
  }, { passive: false });

  window.addEventListener("online", updateConnectionStatus);
  window.addEventListener("offline", updateConnectionStatus);
  window.addEventListener("resize", () => {
    if (viewerMode === "pdfjs") renderCurrentPage({ fitView: true, forceQuality: false });
  });
}

async function handlePdfImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    showToast("Escolha um arquivo PDF.");
    event.target.value = "";
    return;
  }

  try {
    const data = await file.arrayBuffer();
    const georef = extractGeoPdfViewports(data);
    const map = {
      id: randomId(),
      name: file.name,
      size: file.size,
      type: file.type || "application/pdf",
      createdAt: new Date().toISOString(),
      data,
      georef,
    };
    await put(MAP_STORE, map);
    showToast(georef?.views?.length ? "GeoPDF importado com GPS." : "PDF importado.");
    await renderMapList();
  } catch (error) {
    console.error(error);
    showToast("Não foi possível importar o PDF.");
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
    const points = await getPointsByMap(map.id);
    const badge = map.georef?.views?.length
      ? `<span class="geo-badge">GeoPDF • GPS disponível</span>`
      : `<span class="geo-badge">PDF comum</span>`;

    const card = document.createElement("article");
    card.className = "map-card";
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(map.name)}</strong>
        <span>${formatBytes(map.size)} • ${formatDate(map.createdAt)} • ${points.length} ponto(s)</span>
        ${badge}
      </div>
      <div class="card-actions">
        <button class="primary-button" data-action="open">Abrir</button>
        <button class="danger-button" data-action="delete">Excluir</button>
      </div>
    `;

    card.querySelector('[data-action="open"]').addEventListener("click", () => openMap(map.id));
    card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      const ok = confirm(`Excluir o mapa "${map.name}"?`);
      if (!ok) return;
      await deletePointsByMap(map.id);
      await deleteOne(MAP_STORE, map.id);
      await renderMapList();
      showToast("Mapa excluído.");
    });

    ui.mapList.appendChild(card);
  }
}

async function openMap(mapId) {
  try {
    cleanupMap();

    currentMap = await getOne(MAP_STORE, mapId);
    if (!currentMap) {
      showToast("Mapa não encontrado.");
      return;
    }

    await ensureMapGeoref(currentMap);

    document.body.classList.add("map-open", "simple-map");
    forcedRenderQuality = "sharp";
    ui.qualitySelect.value = "sharp";
    applyCleanMapUi();
    ui.currentMapName.textContent = currentMap.name;
    ui.homeScreen.classList.remove("active");
    ui.mapScreen.classList.add("active");

    await nextFrame();
    await nextFrame();

    if (!pdfJsReady) {
      await loadPdfJs();
    }

    if (pdfJsReady) {
      await openPdfJsMap();
    } else {
      openNativeMap("PDF.js não carregou no celular. Abri em modo nativo.");
    }

    await renderPointsList();
    updateGpsForCurrentMap(false);
    prepareLocateButtonForMap();
    applyCleanMapUi();
  } catch (error) {
    console.error(error);
    openNativeMap("O PDF.js falhou neste aparelho. Abri em modo nativo.");
  }
}

async function openPdfJsMap() {
  viewerMode = "pdfjs";
  ui.mapWrapper.classList.remove("native-mode");
  ui.nativePdfFrame.src = "about:blank";
  setPdfControlsEnabled(true);

  ui.viewerNote.innerHTML = currentMap.georef?.views?.length
    ? `<strong>GeoPDF detectado.</strong> Use dois dedos para zoom. GPS pode aparecer dentro do perímetro.`
    : `<strong>Modo PDF.js.</strong> Use dois dedos para zoom. Sem georreferência detectada para GPS no mapa.`;

  const data = currentMap.data.slice(0);
  pdfDoc = await pdfjsLib.getDocument({ data }).promise;
  pageNum = 1;
  await renderCurrentPage({ fitView: true, forceQuality: true });
}

function openNativeMap(message = "Modo nativo.") {
  viewerMode = "native";
  ui.mapWrapper.classList.add("native-mode");
  setPdfControlsEnabled(false);

  ui.viewerNote.innerHTML = `<strong>${escapeHtml(message)}</strong> O mapa aparece nítido, mas GPS/pontos presos ao PDF precisam do modo PDF.js.`;

  if (nativeUrl) URL.revokeObjectURL(nativeUrl);
  const blob = new Blob([currentMap.data], { type: "application/pdf" });
  nativeUrl = URL.createObjectURL(blob);
  ui.nativePdfFrame.src = nativeUrl;
  ui.pageInfo.textContent = "Visualizador nativo";
}

function setPdfControlsEnabled(enabled) {
  ui.prevPageBtn.disabled = !enabled;
  ui.nextPageBtn.disabled = !enabled;
  ui.zoomOutBtn.disabled = !enabled;
  ui.zoomInBtn.disabled = !enabled;
  ui.qualitySelect.disabled = !enabled;
  ui.zoomLabel.textContent = enabled ? `${Math.round(zoom * 100)}%` : "Nativo";
}

async function renderCurrentPage(options = {}) {
  if (!pdfDoc) return;

  const fitView = Boolean(options.fitView);
  const forceQuality = Boolean(options.forceQuality);

  try {
    if (renderTask) {
      try { renderTask.cancel(); } catch {}
      renderTask = null;
    }

    ui.mapStage.classList.add("rendering");

    const page = await pdfDoc.getPage(pageNum);

    const wrapperWidth = Math.max(ui.mapWrapper.clientWidth - 18, window.innerWidth - 24, 300);
    const wrapperHeight = Math.max(ui.mapWrapper.clientHeight - 18, 280);
    const natural = page.getViewport({ scale: 1 });

    const fitScale = Math.min(wrapperWidth / natural.width, wrapperHeight / natural.height) * 0.98;
    const displayScale = Math.min(1, Math.max(0.05, fitScale));
    const displayViewport = page.getViewport({ scale: displayScale });

    currentPdfViewport = displayViewport;
    displaySize = {
      width: displayViewport.width,
      height: displayViewport.height,
    };

    ui.mapStage.style.width = `${Math.floor(displayViewport.width)}px`;
    ui.mapStage.style.height = `${Math.floor(displayViewport.height)}px`;
    ui.pointsLayer.style.width = `${Math.floor(displayViewport.width)}px`;
    ui.pointsLayer.style.height = `${Math.floor(displayViewport.height)}px`;
    ui.gpsLayer.style.width = `${Math.floor(displayViewport.width)}px`;
    ui.gpsLayer.style.height = `${Math.floor(displayViewport.height)}px`;
    if (ui.svgLayer) {
      ui.svgLayer.style.width = `${Math.floor(displayViewport.width)}px`;
      ui.svgLayer.style.height = `${Math.floor(displayViewport.height)}px`;
    }

    const usedSvg = await tryRenderSvgPage(page, displayViewport);

    if (!usedSvg) {
      await renderCanvasPage(page, displayViewport, forceQuality);
    }

    pageRenderMode = usedSvg ? "svg" : "canvas";
    ui.pageInfo.textContent = `Página ${pageNum} de ${pdfDoc.numPages} • ${usedSvg ? "SVG" : "CANVAS"}`;
    ui.prevPageBtn.disabled = pageNum <= 1;
    ui.nextPageBtn.disabled = pageNum >= pdfDoc.numPages;

    if (fitView) resetView();
    else applyTransform();

    await renderMapPoints();
    updateGpsForCurrentMap(false);
    applyCleanMapUi();
  } catch (error) {
    if (error?.name !== "RenderingCancelledException") {
      console.error(error);

      if (pageRenderMode !== "canvas") {
        pageRenderMode = "canvas";
        showToast("SVG falhou. Tentando canvas.");
        await renderCurrentPage({ fitView: true, forceQuality: false });
      } else if (forcedRenderQuality === "sharp") {
        forcedRenderQuality = "ultra";
        ui.qualitySelect.value = "ultra";
        showToast("Ajustei a qualidade automaticamente.");
        await renderCurrentPage({ fitView: true, forceQuality: false });
      } else if (forcedRenderQuality === "ultra") {
        forcedRenderQuality = "hd";
        ui.qualitySelect.value = "hd";
        showToast("Ajustei a qualidade automaticamente.");
        await renderCurrentPage({ fitView: true, forceQuality: false });
      } else if (forcedRenderQuality === "hd") {
        forcedRenderQuality = "light";
        ui.qualitySelect.value = "light";
        showToast("Ajustei a qualidade automaticamente.");
        await renderCurrentPage({ fitView: true, forceQuality: false });
      } else {
        openNativeMap("O celular não conseguiu renderizar este PDF em canvas.");
      }
    }
  } finally {
    ui.mapStage.classList.remove("rendering");
  }
}

async function tryRenderSvgPage(page, displayViewport) {
  try {
    if (!ui.svgLayer || !pdfjsLib.SVGGraphics) return false;

    if (renderTask) {
      try { renderTask.cancel(); } catch {}
      renderTask = null;
    }

    ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
    ui.svgLayer.innerHTML = "";

    const opList = await page.getOperatorList();
    const svgGfx = new pdfjsLib.SVGGraphics(page.commonObjs, page.objs);
    svgGfx.embedFonts = true;

    const svg = await svgGfx.getSVG(opList, displayViewport);
    svg.setAttribute("width", `${Math.floor(displayViewport.width)}px`);
    svg.setAttribute("height", `${Math.floor(displayViewport.height)}px`);
    svg.style.width = `${Math.floor(displayViewport.width)}px`;
    svg.style.height = `${Math.floor(displayViewport.height)}px`;

    ui.svgLayer.appendChild(svg);
    ui.mapStage.classList.remove("canvas-mode");
    ui.mapStage.classList.add("svg-mode");
    return true;
  } catch (error) {
    console.warn("SVG falhou:", error);
    if (ui.svgLayer) ui.svgLayer.innerHTML = "";
    ui.mapStage.classList.remove("svg-mode");
    return false;
  }
}

async function renderCanvasPage(page, displayViewport, forceQuality = false) {
  if (ui.svgLayer) ui.svgLayer.innerHTML = "";
  ui.mapStage.classList.remove("svg-mode");
  ui.mapStage.classList.add("canvas-mode");

  const quality = forcedRenderQuality || "sharp";
  ui.qualitySelect.value = quality;

  const isMobile = window.matchMedia("(max-width: 720px)").matches;
  const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 2.0 : 2.2);

  const baseFactor =
    quality === "sharp" ? 3.15 :
    quality === "ultra" ? 2.45 :
    quality === "hd" ? 1.75 : 1.15;

  const maxZoomQuality =
    quality === "sharp" ? 4.2 :
    quality === "ultra" ? 3.2 :
    quality === "hd" ? 2.4 : 1.6;

  const zoomFactor = forceQuality ? Math.min(Math.max(1, zoom), maxZoomQuality) : 1;
  const maxPixels = getMaxPixels(quality, isMobile);
  const natural = page.getViewport({ scale: 1 });
  const displayScale = displayViewport.width / Math.max(1, natural.width);

  let renderScale = displayScale * dpr * baseFactor * zoomFactor;
  let renderViewport = page.getViewport({ scale: renderScale });

  while (renderViewport.width * renderViewport.height > maxPixels && renderScale > displayScale) {
    renderScale *= 0.84;
    renderViewport = page.getViewport({ scale: renderScale });
  }

  renderQualityZoom = Math.max(1, zoom);

  ui.canvas.width = Math.max(1, Math.floor(renderViewport.width));
  ui.canvas.height = Math.max(1, Math.floor(renderViewport.height));
  ui.canvas.style.width = `${Math.floor(displayViewport.width)}px`;
  ui.canvas.style.height = `${Math.floor(displayViewport.height)}px`;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);

  renderTask = page.render({ canvasContext: ctx, viewport: renderViewport });
  await renderTask.promise;
  renderTask = null;
}

function getMaxPixels(quality, isMobile) {
  if (isMobile) {
    if (quality === "ultra") return 12000000;
    if (quality === "hd") return 8000000;
    return 4500000;
  }

  if (quality === "ultra") return 24000000;
  if (quality === "hd") return 16000000;
  return 8000000;
}

function cleanupMap() {
  if (renderTask) {
    try { renderTask.cancel(); } catch {}
    renderTask = null;
  }

  if (nativeUrl) {
    URL.revokeObjectURL(nativeUrl);
    nativeUrl = null;
  }

  currentMap = null;
  pdfDoc = null;
  pageNum = 1;
  viewerMode = "none";
  currentPdfViewport = null;
  displaySize = { width: 0, height: 0 };
  pendingPoint = null;
  currentGpsCanvas = null;
  gpsAutoCentered = false;
  zoom = 1;
  translate = { x: 0, y: 0 };
  clearTimeout(renderTimer);

  ui.mapWrapper.classList.remove("native-mode");
  ui.nativePdfFrame.src = "about:blank";
  ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
  if (ui.svgLayer) ui.svgLayer.innerHTML = "";
  ui.mapStage.classList.remove("svg-mode", "canvas-mode");
  ui.pointsLayer.innerHTML = "";
  ui.gpsLayer.innerHTML = "";
  ui.pointsList.innerHTML = "";
}

function setZoom(value, centerClientX = null, centerClientY = null) {
  if (viewerMode !== "pdfjs") return;

  const oldZoom = zoom;
  const nextZoom = Math.min(6, Math.max(0.55, value));
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

  ui.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  applyTransform();
  scheduleQualityRender();
}

function scheduleQualityRender(delay = 450) {
  if (viewerMode !== "pdfjs" || !pdfDoc) return;

  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    if (Math.abs(Math.max(1, zoom) - renderQualityZoom) > 0.45 || zoom > 1.8) {
      renderCurrentPage({ fitView: false, forceQuality: true });
    }
  }, delay);
}

function resetView() {
  zoom = 1;
  translate = {
    x: Math.max(8, (ui.mapWrapper.clientWidth - displaySize.width) / 2),
    y: Math.max(8, (ui.mapWrapper.clientHeight - displaySize.height) / 2),
  };
  ui.zoomLabel.textContent = "100%";
  applyTransform();
}

function applyTransform() {
  ui.mapStage.style.transform = `translate3d(${translate.x}px, ${translate.y}px, 0) scale(${zoom})`;
  updateGpsMarkerScale();
}

function handleTouchStart(event) {
  if (viewerMode !== "pdfjs") return;

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
    touchLastPoint = touches[0];
    touchStartTranslate = { ...translate };
    touchMoved = false;
  }
}

function handleTouchMove(event) {
  if (viewerMode !== "pdfjs" || !touchActive) return;

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
    const ratio = distance / touchStartDistance;

    clearTimeout(renderTimer);
    setZoom(touchStartZoom * ratio, center.x, center.y);
    clearTimeout(renderTimer);
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

    touchLastPoint = point;
    applyTransform();
  }
}

function handleTouchEnd(event) {
  if (viewerMode !== "pdfjs" || !touchActive) return;

  event.preventDefault();
  event.stopPropagation();

  const touches = getTouchPoints(event);

  if (touches.length >= 1) {
    if (touches.length === 1) {
      touchMode = "pan";
      touchStartPoint = touches[0];
      touchLastPoint = touches[0];
      touchStartTranslate = { ...translate };
    }
    return;
  }

  if (touchMode === "pinch" || touchMoved) {
    scheduleQualityRender(180);
  }

  if (!touchMoved && touchMode === "pan" && pendingPoint?.waiting) {
    const position = screenToMap(touchLastPoint.x, touchLastPoint.y);
    if (position) {
      pendingPoint = makePointDraft(position.x, position.y, pageNum);
      openPointModal();
    }
  }

  touchActive = false;
  touchMode = "none";
  touchMoved = false;
}

function getTouchPoints(event) {
  return [...event.touches].map((touch) => ({
    x: touch.clientX,
    y: touch.clientY,
  }));
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
  if (event.pointerType === "touch" || viewerMode !== "pdfjs") return;

  ui.mapWrapper.setPointerCapture(event.pointerId);
  isDragging = true;
  dragStart = { x: event.clientX, y: event.clientY };
  translateStart = { ...translate };
}

function handlePointerMove(event) {
  if (event.pointerType === "touch" || !isDragging || viewerMode !== "pdfjs") return;

  translate = {
    x: translateStart.x + event.clientX - dragStart.x,
    y: translateStart.y + event.clientY - dragStart.y,
  };

  applyTransform();
}

function handlePointerUp(event) {
  if (event.pointerType === "touch" || viewerMode !== "pdfjs") return;

  const moved = Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y);
  isDragging = false;

  if (pendingPoint?.waiting && moved < 8) {
    const position = screenToMap(event.clientX, event.clientY);
    if (position) {
      pendingPoint = makePointDraft(position.x, position.y, pageNum);
      openPointModal();
    }
  }
}

function handleDoubleClick(event) {
  if (viewerMode !== "pdfjs") return;

  const position = screenToMap(event.clientX, event.clientY);
  if (!position) return;
  pendingPoint = makePointDraft(position.x, position.y, pageNum);
  openPointModal();
}

function screenToMap(clientX, clientY) {
  const rect = ui.mapWrapper.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;

  const x = (localX - translate.x) / zoom;
  const y = (localY - translate.y) / zoom;

  if (x < 0 || y < 0 || x > displaySize.width || y > displaySize.height) {
    showToast("Toque dentro do PDF.");
    return null;
  }

  return { x, y };
}

function makePointDraft(x, y, page) {
  return {
    waiting: false,
    page,
    x,
    y,
    nx: displaySize.width ? x / displaySize.width : 0,
    ny: displaySize.height ? y / displaySize.height : 0,
  };
}

function openPointModal() {
  ui.pointName.value = "";
  ui.pointArea.value = "";
  ui.pointNote.value = "";
  ui.pointModal.showModal();
  setTimeout(() => ui.pointName.focus(), 80);
}

async function savePendingPoint() {
  if (!currentMap || !pendingPoint || pendingPoint.waiting) return;

  const name = ui.pointName.value.trim();
  if (!name) {
    showToast("Digite o nome do ponto.");
    return;
  }

  const point = {
    id: randomId(),
    mapId: currentMap.id,
    mapName: currentMap.name,
    name,
    area: ui.pointArea.value.trim(),
    note: ui.pointNote.value.trim(),
    page: pendingPoint.page,
    x: pendingPoint.x,
    y: pendingPoint.y,
    nx: pendingPoint.nx,
    ny: pendingPoint.ny,
    lat: pendingPoint.lat,
    lon: pendingPoint.lon,
    accuracy: pendingPoint.accuracy,
    source: pendingPoint.source || "manual",
    createdAt: new Date().toISOString(),
  };

  await put(POINT_STORE, point);
  pendingPoint = null;
  ui.pointModal.close();

  await renderMapPoints();
  await renderPointsList();
  showToast("Ponto salvo.");
}

async function renderMapPoints() {
  ui.pointsLayer.innerHTML = "";
  if (!currentMap || viewerMode !== "pdfjs") return;

  const points = await getPointsByMap(currentMap.id);

  for (const point of points.filter((item) => item.page === pageNum)) {
    const x = Number.isFinite(point.nx) ? point.nx * displaySize.width : point.x;
    const y = Number.isFinite(point.ny) ? point.ny * displaySize.height : point.y;

    const el = document.createElement("button");
    el.className = "map-point";
    el.title = point.name;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.addEventListener("click", () => showToast(point.name));
    ui.pointsLayer.appendChild(el);
  }
}

async function renderPointsList() {
  if (!currentMap) return;

  const points = await getPointsByMap(currentMap.id);
  points.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  ui.emptyPointsState.style.display = points.length ? "none" : "grid";
  ui.pointsList.innerHTML = "";

  for (const point of points) {
    const card = document.createElement("article");
    card.className = "point-card";
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(point.name)}</strong>
        <span>
          Página ${point.page}
          ${point.area ? " • " + escapeHtml(point.area) : ""}
          ${point.lat ? " • GPS" : ""}
          • ${formatDate(point.createdAt)}
          ${point.note ? "<br>" + escapeHtml(point.note) : ""}
        </span>
      </div>
      <div class="card-actions">
        <button class="ghost-button" data-action="go">Ir</button>
        <button class="danger-button" data-action="delete">Excluir</button>
      </div>
    `;

    card.querySelector('[data-action="go"]').addEventListener("click", async () => {
      if (viewerMode !== "pdfjs") {
        showToast("Abrir ponto precisa do modo PDF.js.");
        return;
      }

      if (pageNum !== point.page) {
        pageNum = point.page;
        await renderCurrentPage({ fitView: true, forceQuality: false });
      }

      const x = Number.isFinite(point.nx) ? point.nx * displaySize.width : point.x;
      const y = Number.isFinite(point.ny) ? point.ny * displaySize.height : point.y;

      translate = {
        x: ui.mapWrapper.clientWidth / 2 - x * zoom,
        y: ui.mapWrapper.clientHeight / 2 - y * zoom,
      };
      applyTransform();
      showToast(point.name);
    });

    card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      await deleteOne(POINT_STORE, point.id);
      await renderMapPoints();
      await renderPointsList();
      showToast("Ponto excluído.");
    });

    ui.pointsList.appendChild(card);
  }
}

async function exportCurrentPointsCsv() {
  if (!currentMap) return;

  const points = await getPointsByMap(currentMap.id);
  if (!points.length) {
    showToast("Nenhum ponto para exportar.");
    return;
  }

  const rows = [
    ["mapa", "nome", "area", "pagina", "x", "y", "latitude", "longitude", "precisao", "observacao", "data_hora"],
    ...points.map((point) => [
      point.mapName,
      point.name,
      point.area,
      point.page,
      Math.round(Number(point.x || 0) * 100) / 100,
      Math.round(Number(point.y || 0) * 100) / 100,
      point.lat || "",
      point.lon || "",
      point.accuracy || "",
      point.note,
      point.createdAt,
    ]),
  ];

  const csv = rows.map((row) => row.map(csvCell).join(";")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFileName(currentMap.name)}-pontos.csv`;
  link.click();

  URL.revokeObjectURL(url);
  showToast("CSV exportado.");
}

async function ensureMapGeoref(map) {
  if (map.georef?.views?.length) return map.georef;

  const georef = extractGeoPdfViewports(map.data);
  if (georef?.views?.length) {
    map.georef = georef;
    await put(MAP_STORE, map);
    return georef;
  }

  map.georef = null;
  return null;
}

function extractGeoPdfViewports(arrayBuffer) {
  try {
    const bytes = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : arrayBuffer.slice(0);
    const text = new TextDecoder("iso-8859-1").decode(bytes);
    const views = [];

    const regex = /\/BBox\s*\[([^\]]+)\][\s\S]{0,2600}?\/Name\s*\(([\s\S]*?)\)[\s\S]{0,2600}?\/Measure\s*<<[\s\S]{0,2600}?\/Subtype\s*\/GEO[\s\S]{0,2600}?\/GPTS\s*\[([^\]]+)\][\s\S]{0,2600}?\/LPTS\s*\[([^\]]+)\]/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const view = buildGeoView({
        bbox: parseNumberList(match[1]),
        name: cleanPdfName(match[2]),
        gpts: parseNumberList(match[3]),
        lpts: parseNumberList(match[4]),
        page: 1,
      });
      if (view) views.push(view);
    }

    if (!views.length) {
      const regexNoName = /\/BBox\s*\[([^\]]+)\][\s\S]{0,3600}?\/Measure\s*<<[\s\S]{0,3600}?\/Subtype\s*\/GEO[\s\S]{0,3600}?\/GPTS\s*\[([^\]]+)\][\s\S]{0,3600}?\/LPTS\s*\[([^\]]+)\]/g;
      while ((match = regexNoName.exec(text)) !== null) {
        const view = buildGeoView({
          bbox: parseNumberList(match[1]),
          name: "GeoPDF",
          gpts: parseNumberList(match[2]),
          lpts: parseNumberList(match[3]),
          page: 1,
        });
        if (view) views.push(view);
      }
    }

    if (!views.length) return null;
    views.sort((a, b) => b.area - a.area);
    return { type: "geopdf", detectedAt: new Date().toISOString(), views };
  } catch (error) {
    console.warn("Falha ao detectar GeoPDF:", error);
    return null;
  }
}

function buildGeoView({ bbox, name, gpts, lpts, page }) {
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

  return {
    name: name || "GeoPDF",
    page,
    bbox: bbox.slice(0, 4),
    gpts: gpts.slice(0, 8),
    lpts: lpts.slice(0, 8),
    h,
    area,
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

function toggleGpsTracking() {
  if (gpsWatchId !== null) stopGpsTracking();
  else startGpsTracking();
}

function startGpsTracking() {
  if (!("geolocation" in navigator)) {
    updateGpsUi("error", "Este navegador não tem suporte a GPS.");
    return;
  }

  if (!window.isSecureContext) {
    updateGpsUi("error", "GPS bloqueado: use HTTPS, como GitHub Pages.");
    showToast("GPS precisa de HTTPS no celular.");
    return;
  }

  updateGpsUi("waiting", "Buscando GPS real... permita a localização.");
  const options = { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 };

  navigator.geolocation.getCurrentPosition(handleGpsSuccess, handleGpsError, options);
  gpsWatchId = navigator.geolocation.watchPosition(handleGpsSuccess, handleGpsError, options);
  ui.gpsBtn.textContent = "Parar GPS";
}

function stopGpsTracking() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }

  currentGps = null;
  currentGpsCanvas = null;
  gpsAutoCentered = false;
  ui.gpsLayer.innerHTML = "";
  updateGpsUi("stopped", "GPS desligado.");
  ui.gpsBtn.textContent = "Ativar GPS";
  setGpsActionButtons(false);
}

function handleGpsSuccess(position) {
  currentGps = {
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    accuracy: position.coords.accuracy,
    altitude: position.coords.altitude,
    heading: position.coords.heading,
    speed: position.coords.speed,
    timestamp: position.timestamp,
  };

  updateGpsForCurrentMap(true);
}

function handleGpsError(error) {
  const messages = {
    1: "Permissão de GPS negada.",
    2: "Não foi possível obter a posição.",
    3: "Tempo esgotado procurando GPS.",
  };

  updateGpsUi("error", messages[error.code] || "Erro no GPS.");
  showToast(messages[error.code] || "Erro no GPS.");
}

function updateGpsForCurrentMap(allowAutoCenter = false) {
  if (!currentGps) {
    if (gpsWatchId === null) updateGpsUi("stopped", "GPS desligado.");
    return;
  }

  if (!currentMap) {
    updateGpsUi("active", `GPS ativo: ${formatLatLon(currentGps.lat, currentGps.lon)} • ±${Math.round(currentGps.accuracy || 0)} m`);
    return;
  }

  if (viewerMode !== "pdfjs") {
    updateGpsUi("active", `GPS ativo: ${formatLatLon(currentGps.lat, currentGps.lon)} • mas mapa está em modo nativo.`);
    ui.centerGpsBtn.disabled = true;
    ui.saveGpsPointBtn.disabled = true;
    return;
  }

  if (!currentMap.georef?.views?.length) {
    ui.gpsLayer.innerHTML = "";
    currentGpsCanvas = null;
    updateGpsUi("outside", "GPS ativo, mas este PDF não tem georreferenciamento detectado.");
    ui.centerGpsBtn.disabled = true;
    ui.saveGpsPointBtn.disabled = true;
    return;
  }

  const location = geoToCanvas(currentGps.lat, currentGps.lon);
  if (!location?.inside) {
    ui.gpsLayer.innerHTML = "";
    currentGpsCanvas = null;
    updateGpsUi("outside", `Fora do perímetro do mapa • ${formatLatLon(currentGps.lat, currentGps.lon)} • ±${Math.round(currentGps.accuracy || 0)} m`);
    ui.centerGpsBtn.disabled = true;
    ui.saveGpsPointBtn.disabled = true;
    return;
  }

  currentGpsCanvas = location;
  renderGpsMarker(location);
  updateGpsUi("inside", `<strong>Dentro do mapa</strong> • ${formatLatLon(currentGps.lat, currentGps.lon)} • precisão ±${Math.round(currentGps.accuracy || 0)} m`);
  setGpsActionButtons(true);

  if (allowAutoCenter && !gpsAutoCentered) {
    gpsAutoCentered = true;
    centerOnCurrentGps();
  }
}

function geoToCanvas(lat, lon) {
  if (!currentPdfViewport || !currentMap?.georef?.views?.length) return null;

  const candidates = [];

  for (const view of currentMap.georef.views) {
    if (view.page !== pageNum) continue;

    const uv = applyHomography(view.h, lon, lat);
    if (!uv) continue;

    const tolerance = 0.015;
    const inside = uv.u >= -tolerance && uv.u <= 1 + tolerance && uv.v >= -tolerance && uv.v <= 1 + tolerance;
    if (!inside) continue;

    const bbox = view.bbox;
    const pdfX = bbox[0] + uv.u * (bbox[2] - bbox[0]);
    const pdfY = bbox[1] + uv.v * (bbox[3] - bbox[1]);
    const [x, y] = currentPdfViewport.convertToViewportPoint(pdfX, pdfY);

    candidates.push({
      inside: true,
      page: view.page,
      x,
      y,
      pdfX,
      pdfY,
      u: uv.u,
      v: uv.v,
      view,
    });
  }

  if (!candidates.length) return { inside: false };
  candidates.sort((a, b) => b.view.area - a.view.area);
  return candidates[0];
}

function renderGpsMarker(location) {
  ui.gpsLayer.innerHTML = "";

  const marker = document.createElement("div");
  marker.className = "gps-user-marker";
  marker.style.left = `${location.x}px`;
  marker.style.top = `${location.y}px`;
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

async function centerOnCurrentGps() {
  if (!currentGpsCanvas?.inside) {
    updateGpsForCurrentMap(false);
  }

  if (!currentGpsCanvas?.inside) {
    showToast("GPS ainda não está dentro do perímetro do mapa.");
    return;
  }

  if (pageNum !== currentGpsCanvas.page) {
    pageNum = currentGpsCanvas.page;
    await renderCurrentPage({ fitView: true, forceQuality: false });
  }

  translate = {
    x: ui.mapWrapper.clientWidth / 2 - currentGpsCanvas.x * zoom,
    y: ui.mapWrapper.clientHeight / 2 - currentGpsCanvas.y * zoom,
  };

  applyTransform();
  showToast("Centralizado na sua localização.");
}

function createPointFromGps() {
  if (!currentGpsCanvas?.inside || !currentGps) {
    showToast("Ative o GPS dentro do mapa primeiro.");
    return;
  }

  pendingPoint = makePointDraft(currentGpsCanvas.x, currentGpsCanvas.y, currentGpsCanvas.page);
  pendingPoint.lat = currentGps.lat;
  pendingPoint.lon = currentGps.lon;
  pendingPoint.accuracy = currentGps.accuracy;
  pendingPoint.source = "gps";

  openPointModal();
  ui.pointName.value = "Minha localização";
  ui.pointNote.value = `GPS: ${formatLatLon(currentGps.lat, currentGps.lon)} • precisão ±${Math.round(currentGps.accuracy || 0)} m`;
}


function updateLocateButton(state = "", text = "Localizar") {
  if (!ui.locateBtn) return;
  ui.locateBtn.classList.remove("active", "locating", "outside");
  if (state) ui.locateBtn.classList.add(state);
  ui.locateBtn.textContent = text;
}

function prepareLocateButtonForMap() {
  if (!currentMap) {
    updateLocateButton("", "Localizar");
    return;
  }

  if (!currentMap.georef?.views?.length) {
    updateLocateButton("outside", "Sem GeoPDF");
    return;
  }

  updateLocateButton("", "Localizar");
}

function requestGpsOnceForLocate() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Este navegador não tem suporte a GPS."));
      return;
    }

    if (!window.isSecureContext) {
      reject(new Error("GPS precisa de HTTPS. Use GitHub Pages no celular."));
      return;
    }

    const options = { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 };
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

async function handleLocateButton() {
  if (!currentMap) return;

  if (viewerMode === "native") {
    if (typeof returnToPdfJsMode === "function") {
      await returnToPdfJsMode();
    } else {
      showToast("Modo nativo não permite GPS em cima do mapa.");
      return;
    }
  }

  if (!currentMap.georef?.views?.length) {
    updateLocateButton("outside", "Sem GeoPDF");
    showToast("Este PDF não tem georreferenciamento detectado.");
    return;
  }

  updateLocateButton("locating", "Localizando");
  updateGpsUi("waiting", "Buscando localização... toque em Permitir se aparecer.");

  try {
    const position = await requestGpsOnceForLocate();
    handleGpsSuccess(position);

    if (gpsWatchId === null) {
      const options = { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 };
      gpsWatchId = navigator.geolocation.watchPosition(handleGpsSuccess, handleGpsError, options);
    }

    await nextFrame();

    if (currentGpsCanvas?.inside) {
      await centerOnCurrentGps();
      updateLocateButton("active", "Localizar");
      showToast("Localizado no mapa.");
    } else {
      updateGpsForCurrentMap(false);
      updateLocateButton("outside", "Fora mapa");
      showToast("GPS pegou, mas você está fora do perímetro deste mapa.");
    }
  } catch (error) {
    console.warn(error);
    updateLocateButton("outside", "GPS erro");
    updateGpsUi("error", error.message || "Não consegui pegar GPS.");
    showToast(error.message || "Não consegui pegar GPS.");
  }
}

function setGpsActionButtons(enabled) {
  ui.centerGpsBtn.disabled = !enabled;
  ui.saveGpsPointBtn.disabled = !enabled;
  if (ui.locateBtn) {
    ui.locateBtn.classList.toggle("active", enabled);
  }
}

function updateGpsUi(state = "stopped", message = "") {
  ui.gpsStatus.classList.remove("active", "inside", "outside", "waiting", "error", "ready");

  if (state !== "stopped") {
    ui.gpsStatus.classList.add(state);
  }

  const labels = {
    stopped: "GPS parado",
    waiting: "GPS buscando",
    active: "GPS ativo",
    inside: "GPS no mapa",
    outside: "GPS fora",
    error: "GPS erro",
  };

  ui.gpsStatus.querySelector("span:last-child").textContent = labels[state] || "GPS";
  ui.gpsInfo.innerHTML = message || "GPS desligado.";

  if (state === "waiting") updateLocateButton("locating", "Localizando");
  else if (state === "inside") updateLocateButton("active", "Localizar");
  else if (state === "outside") updateLocateButton("outside", "Fora mapa");
  else if (state === "error") updateLocateButton("outside", "GPS erro");
  else if (state === "active") updateLocateButton("locating", "Localizando");
  else updateLocateButton("", "Localizar");
}

function updateConnectionStatus() {
  const online = navigator.onLine;
  ui.connectionStatus.classList.toggle("online", online);
  ui.connectionStatus.querySelector("span:last-child").textContent = online ? "Online" : "Offline";
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
    console.warn(error);
    location.reload();
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .catch((error) => console.warn("Service Worker não registrado:", error));
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

document.addEventListener("touchmove", (event) => {
  if (!document.body.classList.contains("map-open")) return;
  if (event.target.closest?.("#mapWrapper")) return;
  event.preventDefault();
}, { passive: false });


function applyCleanMapUi() {
  document.body.classList.add("simple-map");
  for (const selector of [".map-controls", ".gps-info", ".viewer-note", ".point-panel"]) {
    const el = document.querySelector(selector);
    if (el) {
      el.hidden = true;
      el.setAttribute("aria-hidden", "true");
      el.style.display = "none";
    }
  }
}

function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatLatLon(lat, lon) {
  return `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`;
}

function safeFileName(name) {
  return String(name || "mapa").replace(/\.pdf$/i, "").replace(/[^\w\-]+/g, "_").slice(0, 70);
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
