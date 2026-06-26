/* GPF Mapas V1.1
   - Sem CDN obrigatório
   - Tenta usar PDF.js local: ./libs/pdf.min.js + ./libs/pdf.worker.min.js
   - Se PDF.js local não existir, usa visualizador nativo do navegador
   - Salva PDFs e pontos em IndexedDB
*/

const DB_NAME = "gpf-mapas-db";
const DB_VERSION = 1;
const MAP_STORE = "maps";
const POINT_STORE = "points";
const LOCAL_PDF_JS = "./libs/pdf.min.js";
const LOCAL_PDF_WORKER = "./libs/pdf.worker.min.js";

const $ = (selector) => document.querySelector(selector);

const ui = {
  homeScreen: $("#homeScreen"),
  mapScreen: $("#mapScreen"),
  pdfInput: $("#pdfInput"),
  refreshMapsBtn: $("#refreshMapsBtn"),
  mapList: $("#mapList"),
  emptyState: $("#emptyState"),
  connectionStatus: $("#connectionStatus"),
  pdfStatus: $("#pdfStatus"),
  toast: $("#toast"),
  viewerNote: $("#viewerNote"),

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
  newPointBtn: $("#newPointBtn"),
  exportPointsBtn: $("#exportPointsBtn"),

  mapWrapper: $("#mapWrapper"),
  mapStage: $("#mapStage"),
  canvas: $("#pdfCanvas"),
  pointsLayer: $("#pointsLayer"),
  nativePdfFrame: $("#nativePdfFrame"),
  nativePointsLayer: $("#nativePointsLayer"),

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
let currentMap = null;
let pdfDoc = null;
let pageNum = 1;
let renderTask = null;
let pdfJsReady = false;
let viewerMode = "native";
let nativeUrl = null;

let zoom = 1;
let translate = { x: 20, y: 20 };
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let translateStart = { x: 0, y: 0 };
let pendingPoint = null;

init();

async function init() {
  try {
    db = await openDatabase();
    setupEvents();
    updateConnectionStatus();
    await loadLocalPdfJs();
    await renderMapList();
    registerServiceWorker();
  } catch (error) {
    console.error(error);
    showToast("Erro ao iniciar o app.");
  }
}

function loadLocalPdfJs() {
  return new Promise((resolve) => {
    if (window.pdfjsLib) {
      preparePdfJs();
      resolve(true);
      return;
    }

    const script = document.createElement("script");
    script.src = LOCAL_PDF_JS;
    script.onload = () => {
      if (window.pdfjsLib) {
        preparePdfJs();
        resolve(true);
      } else {
        markPdfJsMissing();
        resolve(false);
      }
    };
    script.onerror = () => {
      markPdfJsMissing();
      resolve(false);
    };
    document.head.appendChild(script);
  });
}

function preparePdfJs() {
  pdfJsReady = true;
  pdfjsLib.GlobalWorkerOptions.workerSrc = LOCAL_PDF_WORKER;
  ui.pdfStatus.classList.add("ready");
  ui.pdfStatus.querySelector("span:last-child").textContent = "PDF.js local";
}

function markPdfJsMissing() {
  pdfJsReady = false;
  ui.pdfStatus.classList.remove("ready");
  ui.pdfStatus.querySelector("span:last-child").textContent = "Nativo";
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

async function deletePointsByMap(mapId) {
  const points = await getPointsByMap(mapId);
  await Promise.all(points.map((point) => deleteOne(POINT_STORE, point.id)));
}

function getPointsByMap(mapId) {
  return new Promise((resolve, reject) => {
    const index = tx(POINT_STORE).index("mapId");
    const request = index.getAll(mapId);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function setupEvents() {
  ui.pdfInput.addEventListener("change", handlePdfImport);
  ui.refreshMapsBtn.addEventListener("click", renderMapList);

  ui.backBtn.addEventListener("click", () => {
    ui.mapScreen.classList.remove("active");
    ui.homeScreen.classList.add("active");
    cleanupMap();
    renderMapList();
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
    resetView();
    await renderCurrentPage();
  });

  ui.nextPageBtn.addEventListener("click", async () => {
    if (viewerMode !== "pdfjs" || !pdfDoc || pageNum >= pdfDoc.numPages) return;
    pageNum++;
    resetView();
    await renderCurrentPage();
  });

  ui.zoomOutBtn.addEventListener("click", () => viewerMode === "pdfjs" && setZoom(zoom - 0.15));
  ui.zoomInBtn.addEventListener("click", () => viewerMode === "pdfjs" && setZoom(zoom + 0.15));
  ui.resetViewBtn.addEventListener("click", () => viewerMode === "pdfjs" ? resetView() : showToast("Use o zoom nativo do navegador."));

  ui.newPointBtn.addEventListener("click", () => {
    if (!currentMap) return;
    pendingPoint = { waiting: true };
    ui.mapWrapper.classList.toggle("placing-native-point", viewerMode === "native");
    showToast("Toque no local do mapa onde deseja criar o ponto.");
  });

  ui.exportPointsBtn.addEventListener("click", exportCurrentPointsCsv);

  ui.pointForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await savePendingPoint();
  });

  ui.mapWrapper.addEventListener("pointerdown", handlePointerDown);
  ui.mapWrapper.addEventListener("pointermove", handlePointerMove);
  ui.mapWrapper.addEventListener("pointerup", handlePointerUp);
  ui.mapWrapper.addEventListener("pointercancel", handlePointerUp);
  ui.mapWrapper.addEventListener("dblclick", handleDoubleClick);

  ui.mapWrapper.addEventListener("wheel", (event) => {
    if (viewerMode !== "pdfjs") return;
    event.preventDefault();
    setZoom(zoom + (event.deltaY < 0 ? 0.12 : -0.12));
  }, { passive: false });

  window.addEventListener("online", updateConnectionStatus);
  window.addEventListener("offline", updateConnectionStatus);
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
    const map = {
      id: randomId(),
      name: file.name,
      size: file.size,
      type: file.type || "application/pdf",
      createdAt: new Date().toISOString(),
      data,
    };
    await put(MAP_STORE, map);
    showToast("Mapa importado e salvo offline.");
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
    const card = document.createElement("article");
    card.className = "map-card";
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(map.name)}</strong>
        <span>${formatBytes(map.size)} • ${formatDate(map.createdAt)} • ${points.length} ponto(s)</span>
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
      showToast("Mapa excluído.");
      await renderMapList();
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

    ui.currentMapName.textContent = currentMap.name;
    ui.homeScreen.classList.remove("active");
    ui.mapScreen.classList.add("active");

    if (pdfJsReady) {
      await openPdfJsMap();
    } else {
      openNativeMap();
    }

    await renderPointsList();
  } catch (error) {
    console.error(error);
    openNativeMap();
    showToast("Abri pelo visualizador nativo.");
  }
}

async function openPdfJsMap() {
  viewerMode = "pdfjs";
  ui.mapWrapper.classList.remove("native-mode", "placing-native-point");
  ui.viewerNote.textContent = "Modo PDF.js local: zoom, páginas, arrastar e pontos presos ao PDF.";
  setPdfControlsEnabled(true);

  const copy = currentMap.data.slice(0);
  pdfDoc = await pdfjsLib.getDocument({ data: copy }).promise;
  pageNum = 1;
  resetView();
  await renderCurrentPage();
}

function openNativeMap() {
  viewerMode = "native";
  ui.mapWrapper.classList.add("native-mode");
  setPdfControlsEnabled(false);
  ui.viewerNote.textContent = "Modo nativo: funciona sem internet e sem biblioteca externa. Para pontos mais precisos e controles completos, coloque pdf.min.js e pdf.worker.min.js na pasta libs.";
  ui.pageInfo.textContent = "Visualizador nativo do navegador";

  if (nativeUrl) URL.revokeObjectURL(nativeUrl);
  const blob = new Blob([currentMap.data], { type: "application/pdf" });
  nativeUrl = URL.createObjectURL(blob);
  ui.nativePdfFrame.src = nativeUrl;
  renderNativePoints();
}

function setPdfControlsEnabled(enabled) {
  ui.prevPageBtn.disabled = !enabled;
  ui.nextPageBtn.disabled = !enabled;
  ui.zoomOutBtn.disabled = !enabled;
  ui.zoomInBtn.disabled = !enabled;
  ui.resetViewBtn.disabled = false;
  ui.zoomLabel.textContent = enabled ? `${Math.round(zoom * 100)}%` : "Nativo";
}

async function renderCurrentPage() {
  if (!pdfDoc) return;

  try {
    if (renderTask) {
      renderTask.cancel();
      renderTask = null;
    }

    const page = await pdfDoc.getPage(pageNum);
    const wrapperWidth = Math.max(ui.mapWrapper.clientWidth - 40, 320);
    const naturalViewport = page.getViewport({ scale: 1 });
    const baseScale = Math.min(2, Math.max(1, wrapperWidth / naturalViewport.width));
    const viewport = page.getViewport({ scale: baseScale });

    ui.canvas.width = Math.floor(viewport.width);
    ui.canvas.height = Math.floor(viewport.height);
    ui.canvas.style.width = `${Math.floor(viewport.width)}px`;
    ui.canvas.style.height = `${Math.floor(viewport.height)}px`;
    ui.pointsLayer.style.width = `${Math.floor(viewport.width)}px`;
    ui.pointsLayer.style.height = `${Math.floor(viewport.height)}px`;

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);

    renderTask = page.render({ canvasContext: ctx, viewport });
    await renderTask.promise;
    renderTask = null;

    ui.pageInfo.textContent = `Página ${pageNum} de ${pdfDoc.numPages}`;
    ui.prevPageBtn.disabled = pageNum <= 1;
    ui.nextPageBtn.disabled = pageNum >= pdfDoc.numPages;
    applyTransform();
    await renderPdfJsPoints();
  } catch (error) {
    if (error?.name !== "RenderingCancelledException") {
      console.error(error);
      showToast("Erro ao renderizar página.");
    }
  }
}

function cleanupMap() {
  currentMap = null;
  pdfDoc = null;
  pageNum = 1;
  pendingPoint = null;
  viewerMode = "native";
  ui.mapWrapper.classList.remove("native-mode", "placing-native-point");
  ui.viewerNote.textContent = "";

  if (nativeUrl) {
    URL.revokeObjectURL(nativeUrl);
    nativeUrl = null;
  }
  ui.nativePdfFrame.removeAttribute("src");

  if (renderTask) {
    try { renderTask.cancel(); } catch {}
    renderTask = null;
  }
  ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
  ui.pointsLayer.innerHTML = "";
  ui.nativePointsLayer.innerHTML = "";
  ui.pointsList.innerHTML = "";
  resetView();
}

function setZoom(value) {
  zoom = Math.min(3.2, Math.max(0.45, value));
  ui.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  applyTransform();
}

function resetView() {
  zoom = 1;
  translate = { x: 20, y: 20 };
  ui.zoomLabel.textContent = viewerMode === "native" ? "Nativo" : "100%";
  applyTransform();
}

function applyTransform() {
  ui.mapStage.style.transform = `translate(${translate.x}px, ${translate.y}px) scale(${zoom})`;
}

function handlePointerDown(event) {
  if (viewerMode === "native") return;
  ui.mapWrapper.setPointerCapture(event.pointerId);
  isDragging = true;
  dragStart = { x: event.clientX, y: event.clientY };
  translateStart = { ...translate };
  ui.mapStage.classList.add("dragging");
}

function handlePointerMove(event) {
  if (!isDragging || viewerMode !== "pdfjs") return;
  translate = {
    x: translateStart.x + event.clientX - dragStart.x,
    y: translateStart.y + event.clientY - dragStart.y,
  };
  applyTransform();
}

function handlePointerUp(event) {
  if (viewerMode === "native") {
    if (pendingPoint?.waiting) placeNativePoint(event);
    return;
  }

  if (!isDragging) return;
  const moved = Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y);
  isDragging = false;
  ui.mapStage.classList.remove("dragging");

  if (pendingPoint?.waiting && moved < 8) {
    const mapPosition = screenToMap(event.clientX, event.clientY);
    if (mapPosition) {
      pendingPoint = { waiting: false, mode: "pdfjs", page: pageNum, x: mapPosition.x, y: mapPosition.y };
      openPointModal();
    }
  }
}

function handleDoubleClick(event) {
  if (viewerMode === "native") {
    placeNativePoint(event);
    return;
  }

  const mapPosition = screenToMap(event.clientX, event.clientY);
  if (!mapPosition) return;
  pendingPoint = { waiting: false, mode: "pdfjs", page: pageNum, x: mapPosition.x, y: mapPosition.y };
  openPointModal();
}

function screenToMap(clientX, clientY) {
  const wrapperRect = ui.mapWrapper.getBoundingClientRect();
  const localX = clientX - wrapperRect.left;
  const localY = clientY - wrapperRect.top;
  const x = (localX - translate.x) / zoom;
  const y = (localY - translate.y) / zoom;

  if (x < 0 || y < 0 || x > ui.canvas.width || y > ui.canvas.height) {
    showToast("Toque dentro do PDF.");
    return null;
  }
  return { x, y };
}

function placeNativePoint(event) {
  if (!pendingPoint?.waiting || viewerMode !== "native") return;
  const rect = ui.mapWrapper.getBoundingClientRect();
  const px = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
  const py = Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100));
  pendingPoint = { waiting: false, mode: "native", page: 1, px, py };
  ui.mapWrapper.classList.remove("placing-native-point");
  openPointModal();
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
    coordMode: pendingPoint.mode,
    page: pendingPoint.page || 1,
    x: pendingPoint.x ?? null,
    y: pendingPoint.y ?? null,
    px: pendingPoint.px ?? null,
    py: pendingPoint.py ?? null,
    createdAt: new Date().toISOString(),
  };

  await put(POINT_STORE, point);
  pendingPoint = null;
  ui.mapWrapper.classList.remove("placing-native-point");
  ui.pointModal.close();
  showToast("Ponto salvo.");
  await renderPdfJsPoints();
  await renderNativePoints();
  await renderPointsList();
}

async function renderPdfJsPoints() {
  ui.pointsLayer.innerHTML = "";
  if (!currentMap || viewerMode !== "pdfjs") return;

  const points = await getPointsByMap(currentMap.id);
  points
    .filter((point) => point.coordMode === "pdfjs" && point.page === pageNum)
    .forEach((point) => {
      const el = document.createElement("button");
      el.className = "map-point";
      el.title = point.name;
      el.style.left = `${point.x}px`;
      el.style.top = `${point.y}px`;
      el.innerHTML = "<span></span>";
      el.addEventListener("click", () => showToast(`${point.name}${point.area ? " • " + point.area : ""}`));
      ui.pointsLayer.appendChild(el);
    });
}

async function renderNativePoints() {
  ui.nativePointsLayer.innerHTML = "";
  if (!currentMap || viewerMode !== "native") return;

  const points = await getPointsByMap(currentMap.id);
  points
    .filter((point) => point.coordMode === "native")
    .forEach((point) => {
      const el = document.createElement("button");
      el.className = "native-map-point";
      el.title = point.name;
      el.style.left = `${point.px}%`;
      el.style.top = `${point.py}%`;
      el.innerHTML = "<span></span>";
      el.addEventListener("click", () => showToast(`${point.name}${point.area ? " • " + point.area : ""}`));
      ui.nativePointsLayer.appendChild(el);
    });
}

async function renderPointsList() {
  if (!currentMap) return;
  const points = await getPointsByMap(currentMap.id);
  points.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  ui.emptyPointsState.style.display = points.length ? "none" : "grid";
  ui.pointsList.innerHTML = "";

  for (const point of points) {
    const label = point.coordMode === "pdfjs" ? `Página ${point.page}` : "Ponto nativo";
    const card = document.createElement("article");
    card.className = "point-card";
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(point.name)}</strong>
        <span>${label}${point.area ? " • " + escapeHtml(point.area) : ""} • ${formatDate(point.createdAt)}${point.note ? "<br>" + escapeHtml(point.note) : ""}</span>
      </div>
      <div class="card-actions">
        <button class="ghost-button" data-action="go">Ir</button>
        <button class="danger-button" data-action="delete">Excluir</button>
      </div>
    `;

    card.querySelector('[data-action="go"]').addEventListener("click", async () => {
      if (viewerMode === "pdfjs" && point.coordMode === "pdfjs") {
        pageNum = point.page;
        await renderCurrentPage();
        translate = { x: ui.mapWrapper.clientWidth / 2 - point.x * zoom, y: ui.mapWrapper.clientHeight / 2 - point.y * zoom };
        applyTransform();
      } else {
        showToast(point.name);
      }
    });

    card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      await deleteOne(POINT_STORE, point.id);
      showToast("Ponto excluído.");
      await renderPdfJsPoints();
      await renderNativePoints();
      await renderPointsList();
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
    ["mapa", "nome", "talhao_area", "modo", "pagina", "x", "y", "px", "py", "observacao", "data_hora"],
    ...points.map((point) => [
      point.mapName, point.name, point.area, point.coordMode, point.page,
      point.x ?? "", point.y ?? "", point.px ?? "", point.py ?? "", point.note, point.createdAt,
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

function updateConnectionStatus() {
  const online = navigator.onLine;
  ui.connectionStatus.classList.toggle("online", online);
  ui.connectionStatus.querySelector("span:last-child").textContent = online ? "Online" : "Offline";
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => ui.toast.classList.remove("show"), 2600);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("Service Worker não registrado:", error));
  });
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
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function safeFileName(name) {
  return name.replace(/\.pdf$/i, "").replace(/[^\w\-]+/g, "_").slice(0, 60);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function randomId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
