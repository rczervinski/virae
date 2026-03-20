/**
 * pdf-editor.js — Editor visual de PDF estilo iLovePDF.
 * Renderiza PDF client-side com pdfjs, usa metadados de fonte do PyMuPDF
 * para preservar fontes originais. Permite edicao de texto in-place
 * com overlays editaveis, e salva alteracoes via backend.
 * Vanilla JS (ES6+), sem dependencias externas alem do pdfjs-dist.
 */

(() => {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────
  const RENDER_SCALE = 1.5;
  const THUMB_SCALE = 0.3;
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 3.0;
  const ZOOM_STEP = 0.25;

  // CSS font-family mapping from PDF font names
  const FONT_FAMILY_MAP = {
    'helvetica': 'Helvetica, Arial, sans-serif',
    'arial': 'Arial, Helvetica, sans-serif',
    'times': '"Times New Roman", Times, serif',
    'timesnewroman': '"Times New Roman", Times, serif',
    'courier': '"Courier New", Courier, monospace',
    'couriernew': '"Courier New", Courier, monospace',
    'georgia': 'Georgia, serif',
    'verdana': 'Verdana, sans-serif',
    'tahoma': 'Tahoma, sans-serif',
    'trebuchet': '"Trebuchet MS", sans-serif',
    'palatino': '"Palatino Linotype", Palatino, serif',
    'garamond': 'Garamond, serif',
    'bookman': '"Bookman Old Style", serif',
    'cambria': 'Cambria, serif',
    'calibri': 'Calibri, sans-serif',
    'candara': 'Candara, sans-serif',
    'consolas': 'Consolas, monospace',
    'symbol': 'Symbol',
    'zapfdingbats': 'ZapfDingbats',
  };

  // ─── State ──────────────────────────────────────────────────
  let pdfDoc = null;
  let pdfId = null;
  let originalName = '';
  let currentPage = 1;
  let totalPages = 0;
  let currentZoom = RENDER_SCALE;
  let pdfjsLib = null;

  // Font data from PyMuPDF (per-page blocks with font metadata)
  let fontData = null;

  // Per-page data: { canvas, viewport, textBlocks, newTexts, rendered }
  const pageData = {};

  // Track modifications per page: { blockId: { originalText, newText, ... } }
  const modifications = {};

  // Track new text additions per page
  const additions = {};

  // Currently selected tool: 'select' | 'addText'
  let activeTool = 'select';

  // Currently active/focused element (text block or new text)
  let activeElement = null;

  // Current text format options (toolbar state)
  let currentFontSize = 16;
  let currentFontWeight = 'normal';
  let currentFontStyle = 'normal';
  let currentFontFamily = 'Helvetica, Arial, sans-serif';
  let currentColor = '#000000';

  // ─── Font Helpers ─────────────────────────────────────────

  /**
   * Maps a PDF font name (e.g. "ABCDEF+TimesNewRoman-Bold") to a CSS font-family.
   */
  function mapFontToCSS(pdfFontName) {
    if (!pdfFontName) return 'Helvetica, Arial, sans-serif';

    // Remove subset prefix (e.g. "ABCDEF+" or "BCDEEE+")
    let name = pdfFontName.replace(/^[A-Z]{6}\+/, '');

    // Remove style suffixes for matching
    const lower = name.toLowerCase()
      .replace(/[-,]/g, '')
      .replace(/\s+/g, '')
      .replace(/(regular|roman|book|light|medium|semibold|bold|italic|oblique|condensed|narrow|wide|expanded|black|heavy|thin|extra|ultra|demi)/g, '');

    // Try direct mapping
    for (const [key, css] of Object.entries(FONT_FAMILY_MAP)) {
      if (lower.includes(key) || key.includes(lower)) {
        return css;
      }
    }

    // If the font name itself looks usable, use it directly with fallbacks
    const cleanName = name.replace(/-(Regular|Bold|Italic|BoldItalic|Light|Medium|SemiBold|ExtraBold|Black|Thin)$/i, '');
    if (cleanName.length > 1) {
      const isSerif = /times|palatino|garamond|georgia|bookman|cambria/i.test(cleanName);
      const isMono = /courier|consolas|mono/i.test(cleanName);
      const fallback = isMono ? 'monospace' : isSerif ? 'serif' : 'sans-serif';
      return `"${cleanName}", ${fallback}`;
    }

    return 'Helvetica, Arial, sans-serif';
  }

  function isFontBold(pdfFontName) {
    if (!pdfFontName) return false;
    return /bold|black|heavy/i.test(pdfFontName);
  }

  function isFontItalic(pdfFontName) {
    if (!pdfFontName) return false;
    return /italic|oblique/i.test(pdfFontName);
  }

  // ─── Initialize ─────────────────────────────────────────────

  window.openPdfEditor = async function (data) {
    pdfId = data.pdfId;
    originalName = data.originalName || 'documento.pdf';
    fontData = data.fontData || null;

    try {
      pdfjsLib = await import('/vendor/pdfjs/build/pdf.min.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/build/pdf.worker.min.mjs';

      buildEditorUI();

      if (fontData && fontData.fonts) {
        populateFontSelector(fontData.fonts);
      }

      const loadingEl = document.querySelector('.pdf-editor-loading');
      const pdfData = await fetch(data.pdfUrl).then(r => r.arrayBuffer());
      pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
      totalPages = pdfDoc.numPages;

      if (loadingEl) loadingEl.style.display = 'none';

      calculateFitZoom();
      await renderThumbnails();
      await renderPage(1);
      updatePageNav();

    } catch (err) {
      console.error('PDF Editor init error:', err);
      if (window.showToast) window.showToast('Erro ao abrir editor de PDF.', 'error');
      closeEditor();
    }
  };

  // ─── Build Editor UI ────────────────────────────────────────
  function buildEditorUI() {
    const overlay = document.createElement('div');
    overlay.className = 'pdf-editor-overlay';
    overlay.id = 'pdfEditorOverlay';

    overlay.innerHTML = `
      <!-- Toolbar -->
      <div class="pdf-editor-toolbar">
        <div class="pdf-editor-toolbar-left">
          <button class="pdf-editor-back-btn" id="peBackBtn" title="Voltar">
            <span class="material-symbols-outlined">arrow_back</span>
            <span>Voltar</span>
          </button>
          <span class="pe-toolbar-sep"></span>
          <span class="pdf-editor-filename" id="peFilename"></span>
        </div>

        <div class="pdf-editor-toolbar-center" id="peToolbarCenter">
          <!-- Select tool -->
          <button class="pe-tool-btn active" id="peToolSelect" title="Selecionar">
            <span class="material-symbols-outlined">arrow_selector_tool</span>
          </button>
          <!-- Add text tool -->
          <button class="pe-tool-btn" id="peToolAddText" title="Adicionar texto">
            <span class="material-symbols-outlined">add_comment</span>
            <span>Texto</span>
          </button>

          <span class="pe-toolbar-sep"></span>

          <!-- Font family selector -->
          <select class="pe-toolbar-select" id="peFontFamily" title="Familia da fonte">
            <option value="Helvetica, Arial, sans-serif">Helvetica</option>
            <option value="Arial, Helvetica, sans-serif">Arial</option>
            <option value="&quot;Times New Roman&quot;, Times, serif">Times New Roman</option>
            <option value="&quot;Courier New&quot;, Courier, monospace">Courier New</option>
            <option value="Georgia, serif">Georgia</option>
            <option value="Verdana, sans-serif">Verdana</option>
            <option value="Calibri, sans-serif">Calibri</option>
          </select>

          <!-- Font size -->
          <input type="number" class="pe-toolbar-input" id="peFontSize" value="16" min="6" max="72" title="Tamanho da fonte">

          <!-- Bold -->
          <button class="pe-tool-btn" id="peBold" title="Negrito (Ctrl+B)">
            <span class="material-symbols-outlined">format_bold</span>
          </button>

          <!-- Italic -->
          <button class="pe-tool-btn" id="peItalic" title="Italico (Ctrl+I)">
            <span class="material-symbols-outlined">format_italic</span>
          </button>

          <!-- Color -->
          <input type="color" class="pe-toolbar-color" id="peColor" value="#000000" title="Cor do texto">

          <span class="pe-toolbar-sep"></span>

          <!-- Undo -->
          <button class="pe-tool-btn" id="peUndo" title="Desfazer alteracoes da pagina">
            <span class="material-symbols-outlined">undo</span>
          </button>
        </div>

        <div class="pdf-editor-toolbar-right">
          <button class="pe-tool-btn pe-tool-btn--ai" id="peAiBtn" title="Assistente IA">
            <span class="material-symbols-outlined">auto_awesome</span>
            IA
          </button>
          <button class="pe-tool-btn pe-tool-btn--primary" id="peSaveBtn">
            <span class="material-symbols-outlined">download</span>
            Salvar PDF
          </button>
        </div>
      </div>

      <!-- Body -->
      <div class="pdf-editor-body">
        <!-- Sidebar thumbnails -->
        <div class="pdf-editor-sidebar" id="peSidebar"></div>

        <!-- Main canvas area -->
        <div class="pdf-editor-canvas-area" id="peCanvasArea">
          <div class="pdf-editor-loading">
            <div class="pdf-editor-loading-spinner"></div>
            <span>Carregando PDF...</span>
          </div>
        </div>
      </div>

      <!-- Page navigation -->
      <div class="pdf-editor-page-nav">
        <button class="pe-page-nav-btn" id="pePrevPage" title="Pagina anterior">
          <span class="material-symbols-outlined">chevron_left</span>
        </button>
        <div class="pe-page-info">
          <input type="number" class="pe-page-current" id="peCurrentPage" value="1" min="1">
          <span>de <span id="peTotalPages">0</span></span>
        </div>
        <button class="pe-page-nav-btn" id="peNextPage" title="Proxima pagina">
          <span class="material-symbols-outlined">chevron_right</span>
        </button>

        <div class="pe-zoom-controls">
          <button class="pe-page-nav-btn" id="peZoomOut" title="Diminuir zoom">
            <span class="material-symbols-outlined">remove</span>
          </button>
          <span class="pe-zoom-label" id="peZoomLabel">150%</span>
          <button class="pe-page-nav-btn" id="peZoomIn" title="Aumentar zoom">
            <span class="material-symbols-outlined">add</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.getElementById('peFilename').textContent = originalName;
    bindToolbarEvents();
    bindPageNavEvents();
  }

  function populateFontSelector(pdfFonts) {
    const select = document.getElementById('peFontFamily');
    if (!select || !pdfFonts || !pdfFonts.length) return;

    const sep = document.createElement('option');
    sep.disabled = true;
    sep.textContent = '── Fontes do PDF ──';
    select.insertBefore(sep, select.firstChild);

    const added = new Set();
    for (const fontName of pdfFonts) {
      const cssFamily = mapFontToCSS(fontName);
      const cleanName = fontName.replace(/^[A-Z]{6}\+/, '').replace(/-(Regular|Bold|Italic|BoldItalic)$/i, '');
      if (added.has(cleanName)) continue;
      added.add(cleanName);

      const opt = document.createElement('option');
      opt.value = cssFamily;
      opt.textContent = cleanName;
      opt.dataset.pdfFont = fontName;
      select.insertBefore(opt, sep.nextSibling);
    }
  }

  // ─── Toolbar Events ─────────────────────────────────────────
  function bindToolbarEvents() {
    document.getElementById('peBackBtn').addEventListener('click', closeEditor);
    document.getElementById('peToolSelect').addEventListener('click', () => setTool('select'));
    document.getElementById('peToolAddText').addEventListener('click', () => setTool('addText'));
    document.getElementById('peAiBtn').addEventListener('click', toggleAiPanel);

    // CRITICAL: Prevent toolbar buttons from stealing focus from active text element.
    // Without this, clicking Bold causes blur on the text block BEFORE the click handler,
    // which resets the element state before we can apply formatting.
    const toolbarCenter = document.getElementById('peToolbarCenter');
    toolbarCenter.addEventListener('mousedown', (e) => {
      // Allow focus on the font-size input and font-family select
      if (e.target.closest('#peFontSize') || e.target.closest('#peFontFamily')) return;
      e.preventDefault(); // Prevents blur on active text element
    });

    // Font family - applies immediately to active element
    document.getElementById('peFontFamily').addEventListener('change', (e) => {
      currentFontFamily = e.target.value;
      applyFormatToActive();
      // Return focus to active element if it's editable
      if (activeElement) activeElement.focus();
    });

    // Font size
    document.getElementById('peFontSize').addEventListener('change', () => {
      const input = document.getElementById('peFontSize');
      currentFontSize = Math.max(6, Math.min(72, parseInt(input.value, 10) || 16));
      input.value = currentFontSize;
      applyFormatToActive();
      if (activeElement) activeElement.focus();
    });

    // Bold toggle
    document.getElementById('peBold').addEventListener('click', () => {
      const btn = document.getElementById('peBold');
      btn.classList.toggle('active');
      currentFontWeight = btn.classList.contains('active') ? 'bold' : 'normal';
      applyFormatToActive();
    });

    // Italic toggle
    document.getElementById('peItalic').addEventListener('click', () => {
      const btn = document.getElementById('peItalic');
      btn.classList.toggle('active');
      currentFontStyle = btn.classList.contains('active') ? 'italic' : 'normal';
      applyFormatToActive();
    });

    // Color
    document.getElementById('peColor').addEventListener('input', (e) => {
      currentColor = e.target.value;
      applyFormatToActive();
    });

    document.getElementById('peUndo').addEventListener('click', undoPage);
    document.getElementById('peSaveBtn').addEventListener('click', saveEdits);
  }

  function bindPageNavEvents() {
    document.getElementById('pePrevPage').addEventListener('click', () => goToPage(currentPage - 1));
    document.getElementById('peNextPage').addEventListener('click', () => goToPage(currentPage + 1));

    const pageInput = document.getElementById('peCurrentPage');
    pageInput.addEventListener('change', () => {
      const val = parseInt(pageInput.value, 10);
      if (val >= 1 && val <= totalPages) goToPage(val);
      else pageInput.value = currentPage;
    });

    document.getElementById('peZoomOut').addEventListener('click', () => setZoom(currentZoom - ZOOM_STEP));
    document.getElementById('peZoomIn').addEventListener('click', () => setZoom(currentZoom + ZOOM_STEP));
  }

  // ─── Tool Selection ─────────────────────────────────────────
  function setTool(tool) {
    activeTool = tool;
    document.getElementById('peToolSelect').classList.toggle('active', tool === 'select');
    document.getElementById('peToolAddText').classList.toggle('active', tool === 'addText');

    const canvasArea = document.getElementById('peCanvasArea');
    canvasArea.style.cursor = tool === 'addText' ? 'crosshair' : 'default';
  }

  // ─── Active Element & Format Application ───────────────────

  /**
   * Sets the currently active element and syncs toolbar to its style.
   */
  function setActiveElement(el) {
    // Remove highlight from previous
    if (activeElement && activeElement !== el) {
      activeElement.classList.remove('selected');
      // Also remove from wrapper if it was a new text editable
      const prevWrapper = activeElement.closest && activeElement.closest('.pe-new-text');
      if (prevWrapper) prevWrapper.classList.remove('selected');
    }
    activeElement = el;
    if (el) {
      el.classList.add('selected');
      // Also add to wrapper for CSS styling
      const wrapper = el.closest && el.closest('.pe-new-text');
      if (wrapper) wrapper.classList.add('selected');
      syncToolbarFromElement(el);
    }
  }

  /**
   * Reads the active element's style and updates toolbar controls to match.
   */
  function syncToolbarFromElement(el) {
    if (!el) return;

    // For new text editable, fontSize is on the wrapper
    const wrapper = el.classList.contains('pe-new-text-editable') ? el.closest('.pe-new-text') : null;
    const fsSource = wrapper || el;
    currentFontSize = Math.round(parseFloat(fsSource.dataset.fontSize) || 12);
    document.getElementById('peFontSize').value = currentFontSize;

    // Font weight
    const computed = window.getComputedStyle(el);
    const isBold = computed.fontWeight === 'bold' || parseInt(computed.fontWeight) >= 700;
    currentFontWeight = isBold ? 'bold' : 'normal';
    document.getElementById('peBold').classList.toggle('active', isBold);

    // Font style
    const isItalic = computed.fontStyle === 'italic';
    currentFontStyle = isItalic ? 'italic' : 'normal';
    document.getElementById('peItalic').classList.toggle('active', isItalic);

    // Color — use dataset for text blocks, computed for new text
    if (el.classList.contains('pe-text-block')) {
      currentColor = el.dataset.fontColor || '#000000';
    } else {
      currentColor = rgbToHex(computed.color) || '#000000';
    }
    document.getElementById('peColor').value = currentColor;

    // Font family
    const ff = el.style.fontFamily || computed.fontFamily || 'Helvetica, Arial, sans-serif';
    currentFontFamily = ff;
    const select = document.getElementById('peFontFamily');
    let matched = false;

    // Normalize for comparison: remove quotes and whitespace
    const normalize = (s) => s.replace(/['"]/g, '').trim().toLowerCase();
    const ffNorm = normalize(ff.split(',')[0]);

    for (const opt of select.options) {
      if (opt.disabled) continue;
      const optNorm = normalize(opt.value.split(',')[0]);
      const optTextNorm = normalize(opt.textContent);
      if (optNorm === ffNorm || optTextNorm === ffNorm || ffNorm.includes(optTextNorm) || optTextNorm.includes(ffNorm)) {
        select.value = opt.value;
        matched = true;
        break;
      }
    }
    if (!matched) {
      select.selectedIndex = 0;
    }
  }

  /**
   * Applies current toolbar format to the active element.
   * Works for BOTH existing text blocks (.pe-text-block) and new text (.pe-new-text).
   */
  function applyFormatToActive() {
    if (!activeElement) return;

    const el = activeElement;

    // Apply visual styles immediately
    el.style.fontWeight = currentFontWeight;
    el.style.fontStyle = currentFontStyle;
    el.style.fontFamily = currentFontFamily;
    el.style.color = currentColor;

    if (el.classList.contains('pe-text-block')) {
      // Scale fontSize from PDF pts to viewport px
      const viewFontSize = currentFontSize * currentZoom;
      el.style.fontSize = viewFontSize + 'px';

      // Update stored data
      el.dataset.fontSize = currentFontSize;
      el.dataset.fontColor = currentColor;
      el.dataset.fontBold = currentFontWeight === 'bold' ? '1' : '0';
      el.dataset.fontItalic = currentFontStyle === 'italic' ? '1' : '0';

      // Mark as modified — this MUST happen so blur handler doesn't reset
      el.classList.add('modified');

      // Update modification record
      const pageNum = parseInt(el.dataset.page, 10);
      const blockId = el.dataset.blockId;
      if (!modifications[pageNum]) modifications[pageNum] = {};

      modifications[pageNum][blockId] = {
        originalText: el.dataset.origText,
        newText: el.textContent,
        x: parseFloat(el.dataset.pdfX),
        y: parseFloat(el.dataset.pdfY),
        width: parseFloat(el.dataset.pdfWidth),
        height: parseFloat(el.dataset.pdfHeight),
        fontSize: currentFontSize,
        fontName: el.dataset.fontName || '',
        fontWeight: currentFontWeight,
        fontStyle: currentFontStyle,
        fontFamily: currentFontFamily,
        color: currentColor,
      };

    } else if (el.classList.contains('pe-new-text-editable') || el.classList.contains('pe-new-text')) {
      // fontSize is in PDF points — scale by zoom for display
      el.style.fontSize = (currentFontSize * currentZoom) + 'px';
      // Store fontSize on wrapper (pe-new-text) which has the dataset
      const wrapper = el.classList.contains('pe-new-text') ? el : el.closest('.pe-new-text');
      if (wrapper) wrapper.dataset.fontSize = currentFontSize;

      const pageNum = parseInt((wrapper || el).dataset.page, 10);
      const idx = parseInt((wrapper || el).dataset.idx, 10);
      if (additions[pageNum] && additions[pageNum][idx]) {
        additions[pageNum][idx].fontSize = currentFontSize;
        additions[pageNum][idx].fontWeight = currentFontWeight;
        additions[pageNum][idx].fontStyle = currentFontStyle;
        additions[pageNum][idx].fontFamily = currentFontFamily;
        additions[pageNum][idx].color = currentColor;
      }
    }
  }

  /**
   * Convert CSS rgb(r, g, b) to hex.
   */
  function rgbToHex(rgb) {
    if (!rgb) return '#000000';
    if (rgb.startsWith('#')) return rgb;
    const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (!match) return '#000000';
    const r = parseInt(match[1]).toString(16).padStart(2, '0');
    const g = parseInt(match[2]).toString(16).padStart(2, '0');
    const b = parseInt(match[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }

  // ─── Calculate Fit Zoom ──────────────────────────────────────
  function calculateFitZoom() {
    const canvasArea = document.getElementById('peCanvasArea');
    const sidebar = document.getElementById('peSidebar');
    if (!canvasArea) return;

    const sidebarWidth = sidebar ? sidebar.offsetWidth : 0;
    const availableWidth = window.innerWidth - sidebarWidth - 60;
    const availableHeight = window.innerHeight - 120;

    const pdfWidth = 612;
    const pdfHeight = 792;

    const fitWidthZoom = availableWidth / pdfWidth;
    const fitHeightZoom = availableHeight / pdfHeight;
    const fitZoom = Math.min(fitWidthZoom, fitHeightZoom, MAX_ZOOM);

    currentZoom = Math.max(MIN_ZOOM, Math.round(fitZoom * 4) / 4);
    document.getElementById('peZoomLabel').textContent = Math.round(currentZoom * 100) + '%';
  }

  // ─── Render Thumbnails ──────────────────────────────────────
  async function renderThumbnails() {
    const sidebar = document.getElementById('peSidebar');
    sidebar.innerHTML = '';

    for (let i = 1; i <= totalPages; i++) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: THUMB_SCALE });

      const item = document.createElement('div');
      item.className = 'pe-thumb-item' + (i === 1 ? ' active' : '');
      item.dataset.page = i;

      const canvas = document.createElement('canvas');
      canvas.className = 'pe-thumb-canvas';
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      const label = document.createElement('span');
      label.className = 'pe-thumb-label';
      label.textContent = i;

      item.appendChild(canvas);
      item.appendChild(label);
      sidebar.appendChild(item);

      item.addEventListener('click', () => goToPage(i));
    }
  }

  // ─── Render Page ────────────────────────────────────────────
  async function renderPage(pageNum) {
    const canvasArea = document.getElementById('peCanvasArea');

    const existing = canvasArea.querySelector('.pdf-editor-page-wrapper');
    if (existing) existing.remove();

    let loadingEl = canvasArea.querySelector('.pdf-editor-loading');
    if (!loadingEl) {
      loadingEl = document.createElement('div');
      loadingEl.className = 'pdf-editor-loading';
      loadingEl.innerHTML = '<div class="pdf-editor-loading-spinner"></div><span>Renderizando...</span>';
      canvasArea.appendChild(loadingEl);
    }
    loadingEl.style.display = 'flex';

    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: currentZoom });

      const wrapper = document.createElement('div');
      wrapper.className = 'pdf-editor-page-wrapper';
      wrapper.style.width = viewport.width + 'px';
      wrapper.style.height = viewport.height + 'px';

      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-editor-page-canvas';
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';

      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      const textLayer = document.createElement('div');
      textLayer.className = 'pdf-editor-text-layer';

      wrapper.appendChild(canvas);
      wrapper.appendChild(textLayer);

      // Create text overlays using PyMuPDF data or pdfjs fallback
      if (fontData && fontData.pages && fontData.pages[pageNum - 1]) {
        createFontAwareOverlays(fontData.pages[pageNum - 1], viewport, textLayer, pageNum);
      } else {
        await createTextOverlaysFallback(page, viewport, textLayer, pageNum);
      }

      // Restore new text additions
      restoreNewTexts(textLayer, pageNum, viewport, page);

      // Click handler for adding new text
      wrapper.addEventListener('mousedown', (e) => handleCanvasClick(e, textLayer, pageNum, viewport, page));

      loadingEl.style.display = 'none';
      canvasArea.appendChild(wrapper);

      pageData[pageNum] = { canvas, viewport, textLayer, page };

      currentPage = pageNum;
      activeElement = null;
      updatePageNav();
      updateThumbActive();

    } catch (err) {
      console.error('Render page error:', err);
      loadingEl.innerHTML = '<span>Erro ao renderizar pagina.</span>';
    }
  }

  // ─── Create Font-Aware Overlays (PyMuPDF data) ─────────────
  function createFontAwareOverlays(pageInfo, viewport, textLayer, pageNum) {
    const blocks = pageInfo.blocks || [];
    const pdfWidth = pageInfo.width;
    const pdfHeight = pageInfo.height;
    const scaleX = viewport.width / pdfWidth;
    const scaleY = viewport.height / pdfHeight;

    blocks.forEach((block, idx) => {
      if (!block.text || !block.text.trim()) return;

      const blockId = `${pageNum}_${idx}`;
      const div = document.createElement('div');
      div.className = 'pe-text-block';
      div.contentEditable = 'true';
      div.spellcheck = false;
      div.dataset.blockId = blockId;
      div.dataset.page = pageNum;
      div.dataset.origText = block.text;

      // PDF coordinates (PyMuPDF top-left origin)
      div.dataset.pdfX = block.x;
      div.dataset.pdfY = block.y;
      div.dataset.pdfWidth = block.width;
      div.dataset.pdfHeight = block.height;

      // Font metadata
      div.dataset.fontName = block.font_name || '';
      div.dataset.fontSize = block.font_size || 12;
      div.dataset.fontColor = block.color || '#000000';
      div.dataset.fontBold = (block.bold || isFontBold(block.font_name)) ? '1' : '0';
      div.dataset.fontItalic = (block.italic || isFontItalic(block.font_name)) ? '1' : '0';

      // Position in viewport coordinates
      const viewX = block.x * scaleX;
      const viewY = block.y * scaleY;
      const viewWidth = block.width * scaleX;
      const viewHeight = block.height * scaleY;
      const viewFontSize = block.font_size * scaleY;

      div.style.left = viewX + 'px';
      div.style.top = viewY + 'px';
      div.style.width = (viewWidth + 4) + 'px';
      div.style.height = viewHeight + 'px';
      div.style.fontSize = viewFontSize + 'px';
      div.style.lineHeight = '1.15';

      // Apply font styling from PDF metadata
      const cssFamily = mapFontToCSS(block.font_name);
      div.style.fontFamily = cssFamily;

      if (block.bold || isFontBold(block.font_name)) {
        div.style.fontWeight = 'bold';
      }
      if (block.italic || isFontItalic(block.font_name)) {
        div.style.fontStyle = 'italic';
      }

      div.textContent = block.text;

      // Restore previous modifications
      if (modifications[pageNum] && modifications[pageNum][blockId]) {
        const mod = modifications[pageNum][blockId];
        div.textContent = mod.newText;
        div.classList.add('modified');
        if (mod.fontWeight) div.style.fontWeight = mod.fontWeight;
        if (mod.fontStyle) div.style.fontStyle = mod.fontStyle;
        if (mod.fontFamily) div.style.fontFamily = mod.fontFamily;
        if (mod.color) {
          div.style.color = mod.color;
          div.dataset.fontColor = mod.color;
        }
        if (mod.fontSize) {
          div.style.fontSize = (mod.fontSize * scaleY) + 'px';
          div.dataset.fontSize = mod.fontSize;
        }
      }

      // Events
      div.addEventListener('focus', () => {
        div.classList.add('editing');
        // Show text in its actual color when editing
        div.style.color = div.dataset.fontColor || '#000000';
        setActiveElement(div);
      });

      div.addEventListener('blur', () => {
        div.classList.remove('editing');
        const currentText = div.textContent;
        const origText = div.dataset.origText;
        const isModified = div.classList.contains('modified');
        const textChanged = currentText !== origText;

        if (textChanged || isModified) {
          // Text was changed or formatting was applied — keep as modified
          if (!modifications[pageNum]) modifications[pageNum] = {};
          modifications[pageNum][blockId] = {
            originalText: origText,
            newText: currentText,
            x: block.x,
            y: block.y,
            width: block.width,
            height: block.height,
            fontSize: parseFloat(div.dataset.fontSize) || block.font_size || 12,
            fontName: div.dataset.fontName || block.font_name || '',
            fontWeight: div.style.fontWeight || 'normal',
            fontStyle: div.style.fontStyle || 'normal',
            fontFamily: div.style.fontFamily || mapFontToCSS(block.font_name) || 'sans-serif',
            color: div.dataset.fontColor || block.color || '#000000',
          };
          div.classList.add('modified');
          // Keep text visible with its color (CSS .modified handles background)
          div.style.color = div.dataset.fontColor || '#000000';
        } else {
          // No changes at all — revert to transparent overlay
          if (modifications[pageNum]) delete modifications[pageNum][blockId];
          div.classList.remove('modified');
          div.style.color = 'transparent';
        }
      });

      div.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') div.blur();
      });

      textLayer.appendChild(div);
    });
  }

  // ─── Fallback: Create Text Overlays (pdfjs only) ───────────
  async function createTextOverlaysFallback(page, viewport, textLayer, pageNum) {
    const textContent = await page.getTextContent();
    const items = textContent.items.filter(item => item.str && item.str.trim());
    const lines = groupTextByLines(items, viewport, page);

    lines.forEach((line, idx) => {
      const blockId = `${pageNum}_${idx}`;
      const div = document.createElement('div');
      div.className = 'pe-text-block';
      div.contentEditable = 'true';
      div.spellcheck = false;
      div.dataset.blockId = blockId;
      div.dataset.page = pageNum;
      div.dataset.origText = line.text;
      div.dataset.pdfX = line.pdfX;
      div.dataset.pdfY = line.pdfY;
      div.dataset.pdfWidth = line.pdfWidth;
      div.dataset.pdfHeight = line.pdfHeight;
      div.dataset.fontName = '';
      div.dataset.fontSize = line.pdfFontSize;
      div.dataset.fontColor = '#000000';
      div.dataset.fontBold = '0';
      div.dataset.fontItalic = '0';

      div.style.left = line.x + 'px';
      div.style.top = line.y + 'px';
      div.style.width = (line.width + 4) + 'px';
      div.style.height = line.height + 'px';
      div.style.fontSize = line.fontSize + 'px';
      div.style.lineHeight = '1.15';

      div.textContent = line.text;

      if (modifications[pageNum] && modifications[pageNum][blockId]) {
        const mod = modifications[pageNum][blockId];
        div.textContent = mod.newText;
        div.classList.add('modified');
      }

      div.addEventListener('focus', () => {
        div.classList.add('editing');
        div.style.color = div.dataset.fontColor || '#000000';
        setActiveElement(div);
      });

      div.addEventListener('blur', () => {
        div.classList.remove('editing');
        const currentText = div.textContent;
        const origText = div.dataset.origText;
        const isModified = div.classList.contains('modified');

        if (currentText !== origText || isModified) {
          if (!modifications[pageNum]) modifications[pageNum] = {};
          modifications[pageNum][blockId] = {
            originalText: origText,
            newText: currentText,
            x: parseFloat(div.dataset.pdfX),
            y: parseFloat(div.dataset.pdfY),
            width: parseFloat(div.dataset.pdfWidth),
            height: parseFloat(div.dataset.pdfHeight),
            fontSize: parseFloat(div.dataset.fontSize) || line.pdfFontSize,
            fontName: '',
            fontWeight: div.style.fontWeight || 'normal',
            fontStyle: div.style.fontStyle || 'normal',
            color: div.dataset.fontColor || '#000000',
          };
          div.classList.add('modified');
          div.style.color = div.dataset.fontColor || '#000000';
        } else {
          if (modifications[pageNum]) delete modifications[pageNum][blockId];
          div.classList.remove('modified');
          div.style.color = 'transparent';
        }
      });

      div.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') div.blur();
      });

      textLayer.appendChild(div);
    });
  }

  // ─── Group text items by lines (pdfjs fallback) ────────────
  function groupTextByLines(items, viewport, page) {
    const lines = [];

    for (const item of items) {
      if (!item.str.trim()) continue;

      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontSize = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
      const x = tx[4];
      const y = tx[5] - fontSize;
      const width = item.width * viewport.scale;
      const height = fontSize * 1.2;

      const pdfX = item.transform[4];
      const pdfY = item.transform[5];
      const pdfFontSize = Math.abs(item.transform[3]) || Math.abs(item.transform[0]);
      const pdfWidth = item.width;
      const pdfHeight = pdfFontSize * 1.2;

      const tolerance = Math.max(5, fontSize * 0.5);

      let merged = false;
      for (const line of lines) {
        if (Math.abs(line.y - y) < tolerance && Math.abs(line.fontSize - fontSize) < fontSize * 0.3) {
          const newRight = Math.max(line.x + line.width, x + width);
          const newLeft = Math.min(line.x, x);
          line.width = newRight - newLeft;
          line.x = newLeft;
          if (x > line.x + line.width * 0.5) {
            line.text += item.str;
          } else {
            line.text = item.str + line.text;
          }
          line.height = Math.max(line.height, height);
          const newPdfLeft = Math.min(line.pdfX, pdfX);
          line.pdfWidth = Math.max(line.pdfX + line.pdfWidth, pdfX + pdfWidth) - newPdfLeft;
          line.pdfX = newPdfLeft;
          merged = true;
          break;
        }
      }

      if (!merged) {
        lines.push({
          text: item.str,
          x, y, width, height, fontSize,
          pdfX, pdfY, pdfWidth, pdfHeight, pdfFontSize,
        });
      }
    }

    return lines;
  }

  // ─── Handle Click on Canvas (add new text) ──────────────────
  function handleCanvasClick(e, textLayer, pageNum, viewport, page) {
    if (activeTool !== 'addText') return;
    if (e.target.closest('.pe-text-block') || e.target.closest('.pe-new-text')) return;

    const rect = textLayer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    addNewTextBox(textLayer, pageNum, x, y, viewport, page);
    setTool('select');
  }

  // ─── Add New Text Box ──────────────────────────────────────
  function addNewTextBox(textLayer, pageNum, x, y, viewport, page) {
    if (!additions[pageNum]) additions[pageNum] = [];
    const idx = additions[pageNum].length;

    const pdfPageSize = page.getViewport({ scale: 1 });
    const scaleX = pdfPageSize.width / viewport.width;
    const scaleY = pdfPageSize.height / viewport.height;
    const pdfX = x * scaleX;
    const pdfY = pdfPageSize.height - (y * scaleY);

    // Try to detect the dominant font on the page for new text
    let inheritedFont = currentFontFamily;
    let inheritedSize = currentFontSize;
    let inheritedColor = currentColor;
    let inheritedWeight = currentFontWeight;
    let inheritedStyle = currentFontStyle;

    if (fontData && fontData.pages && fontData.pages[pageNum - 1]) {
      const pageBlocks = fontData.pages[pageNum - 1].blocks || [];
      if (pageBlocks.length > 0) {
        // Find the closest text block to inherit font from.
        // Both block.x/y and click x/y are in viewport coordinates conceptually,
        // but block coords are in PDF space (top-left origin, same as PyMuPDF).
        // Convert click to PDF space for proper comparison.
        let closest = null;
        let closestDist = Infinity;
        const clickPdfX = x * scaleX;
        const clickPdfY = y * scaleY; // Both are top-left origin

        for (const block of pageBlocks) {
          const dist = Math.abs(block.y - clickPdfY) + Math.abs(block.x - clickPdfX) * 0.3;
          if (dist < closestDist) {
            closestDist = dist;
            closest = block;
          }
        }

        if (closest) {
          inheritedFont = mapFontToCSS(closest.font_name);
          // Store PDF point size (same as existing blocks), will be scaled by zoom for display
          inheritedSize = Math.round(closest.font_size || 12);
          inheritedColor = closest.color || '#000000';
          inheritedWeight = (closest.bold || isFontBold(closest.font_name)) ? 'bold' : 'normal';
          inheritedStyle = (closest.italic || isFontItalic(closest.font_name)) ? 'italic' : 'normal';
        }
      }
    }

    const textData = {
      text: '',
      x: pdfX,
      y: pdfY,
      viewX: x,
      viewY: y,
      fontSize: inheritedSize,
      fontWeight: inheritedWeight,
      fontStyle: inheritedStyle,
      fontFamily: inheritedFont,
      color: inheritedColor,
    };

    additions[pageNum].push(textData);

    const wrapper = createNewTextElement(textData, pageNum, idx);
    textLayer.appendChild(wrapper);

    setTimeout(() => {
      const editDiv = wrapper.querySelector('.pe-new-text-editable');
      if (editDiv) {
        editDiv.focus();
        setActiveElement(editDiv);
      }
    }, 50);
  }

  function isColorTooLight(hex) {
    if (!hex || !hex.startsWith('#')) return false;
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    return luminance > 0.85;
  }

  function createNewTextElement(textData, pageNum, idx) {
    // Wrapper holds both the editable area and the delete button
    const wrapper = document.createElement('div');
    wrapper.className = 'pe-new-text';
    wrapper.dataset.page = pageNum;
    wrapper.dataset.idx = idx;

    wrapper.style.left = textData.viewX + 'px';
    wrapper.style.top = textData.viewY + 'px';

    // The actual editable area
    const editDiv = document.createElement('div');
    editDiv.className = 'pe-new-text-editable';
    editDiv.contentEditable = 'true';
    editDiv.spellcheck = false;

    // fontSize is stored in PDF points — scale by zoom for display
    editDiv.style.fontSize = (textData.fontSize * currentZoom) + 'px';
    wrapper.dataset.fontSize = textData.fontSize; // Store PDF pt size
    editDiv.style.fontWeight = textData.fontWeight || 'normal';
    editDiv.style.fontStyle = textData.fontStyle || 'normal';
    editDiv.style.fontFamily = textData.fontFamily || 'Helvetica, Arial, sans-serif';

    // Guard against near-white inherited colors
    const textColor = isColorTooLight(textData.color) ? '#000000' : (textData.color || '#000000');
    editDiv.style.color = textColor;
    editDiv.style.minWidth = '80px';
    editDiv.style.outline = 'none';

    if (textData.text) editDiv.textContent = textData.text;

    // Delete button — sibling of editDiv, NOT inside contentEditable
    const delBtn = document.createElement('button');
    delBtn.className = 'pe-new-text-delete';
    delBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px">close</span>';
    delBtn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevent blur on editDiv
      e.stopPropagation();
    });
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeNewText(pageNum, idx, wrapper);
    });

    wrapper.appendChild(editDiv);
    wrapper.appendChild(delBtn);

    // Focus: select this element and sync toolbar
    editDiv.addEventListener('focus', () => {
      setActiveElement(editDiv);
      wrapper.classList.add('editing');
    });

    editDiv.addEventListener('blur', () => {
      wrapper.classList.remove('editing');
      if (additions[pageNum] && additions[pageNum][idx]) {
        // Only get text from editDiv (no delete button text pollution)
        additions[pageNum][idx].text = editDiv.textContent.replace(/\u200B/g, '');
      }
    });

    editDiv.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') editDiv.blur();
    });

    makeDraggable(wrapper, pageNum, idx);

    return wrapper;
  }

  // ─── Make New Text Draggable ────────────────────────────────
  function makeDraggable(el, pageNum, idx) {
    let startX, startY, origLeft, origTop;
    let isDragging = false;

    el.addEventListener('mousedown', (e) => {
      if (e.target.closest('.pe-new-text-delete')) return;
      // Don't drag if user is clicking inside the editable area while it's focused
      const editDiv = el.querySelector('.pe-new-text-editable');
      if (editDiv && editDiv.contains(e.target) && document.activeElement === editDiv) return;

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origLeft = parseInt(el.style.left, 10) || 0;
      origTop = parseInt(el.style.top, 10) || 0;
      el.style.zIndex = '25';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      el.style.left = (origLeft + e.clientX - startX) + 'px';
      el.style.top = (origTop + e.clientY - startY) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      el.style.zIndex = '20';

      if (additions[pageNum] && additions[pageNum][idx]) {
        const viewX = parseInt(el.style.left, 10) || 0;
        const viewY = parseInt(el.style.top, 10) || 0;
        additions[pageNum][idx].viewX = viewX;
        additions[pageNum][idx].viewY = viewY;

        const pd = pageData[pageNum];
        if (pd) {
          const pdfPageSize = pd.page.getViewport({ scale: 1 });
          const scaleX = pdfPageSize.width / pd.viewport.width;
          const scaleY = pdfPageSize.height / pd.viewport.height;
          additions[pageNum][idx].x = viewX * scaleX;
          additions[pageNum][idx].y = pdfPageSize.height - (viewY * scaleY);
        }
      }
    });
  }

  function removeNewText(pageNum, idx, el) {
    if (additions[pageNum]) {
      additions[pageNum][idx] = null;
    }
    // activeElement might be the inner editable or the wrapper itself
    if (activeElement === el || (activeElement && el.contains(activeElement))) {
      activeElement = null;
    }
    el.remove();
  }

  function restoreNewTexts(textLayer, pageNum, viewport, page) {
    if (!additions[pageNum]) return;

    additions[pageNum].forEach((textData, idx) => {
      if (!textData) return;
      const div = createNewTextElement(textData, pageNum, idx);
      textLayer.appendChild(div);
    });
  }

  // ─── Page Navigation ────────────────────────────────────────
  async function goToPage(num) {
    if (num < 1 || num > totalPages || num === currentPage) return;
    await renderPage(num);
  }

  function updatePageNav() {
    document.getElementById('peCurrentPage').value = currentPage;
    document.getElementById('peCurrentPage').max = totalPages;
    document.getElementById('peTotalPages').textContent = totalPages;
    document.getElementById('pePrevPage').disabled = currentPage <= 1;
    document.getElementById('peNextPage').disabled = currentPage >= totalPages;
  }

  function updateThumbActive() {
    document.querySelectorAll('.pe-thumb-item').forEach(item => {
      item.classList.toggle('active', parseInt(item.dataset.page, 10) === currentPage);
    });
    const active = document.querySelector('.pe-thumb-item.active');
    if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ─── Zoom ───────────────────────────────────────────────────
  function setZoom(newZoom) {
    newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    if (newZoom === currentZoom) return;
    currentZoom = newZoom;
    document.getElementById('peZoomLabel').textContent = Math.round(currentZoom * 100) + '%';
    renderPage(currentPage);
  }

  // ─── Undo Page ──────────────────────────────────────────────
  function undoPage() {
    const pageNum = currentPage;
    if (modifications[pageNum]) delete modifications[pageNum];
    if (additions[pageNum]) delete additions[pageNum];
    activeElement = null;
    renderPage(pageNum);
    if (window.showToast) window.showToast('Alteracoes da pagina desfeitas.', 'info');
  }

  // ─── Save Edits ─────────────────────────────────────────────
  async function saveEdits() {
    const saveBtn = document.getElementById('peSaveBtn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span> Salvando...';

    try {
      const changes = [];

      const allPages = new Set([
        ...Object.keys(modifications).map(Number),
        ...Object.keys(additions).map(Number),
      ]);

      for (const pageNum of allPages) {
        const change = { pageNum, modifications: [], additions: [] };

        if (modifications[pageNum]) {
          for (const [blockId, mod] of Object.entries(modifications[pageNum])) {
            change.modifications.push({
              type: 'edit',
              blockId,
              originalText: mod.originalText,
              newText: mod.newText,
              x: mod.x,
              y: mod.y,
              width: mod.width,
              height: mod.height,
              fontSize: mod.fontSize,
              fontName: mod.fontName || '',
              fontWeight: mod.fontWeight || 'normal',
              fontFamily: mod.fontFamily || '',
              color: mod.color || '#000000',
            });
          }
        }

        if (additions[pageNum]) {
          for (const add of additions[pageNum]) {
            if (!add || !add.text || !add.text.trim()) continue;
            // fontSize is already stored in PDF points
            change.additions.push({
              type: 'add',
              text: add.text,
              x: add.x,
              y: add.y,
              fontSize: add.fontSize,
              fontName: add.fontFamily || '',
              fontWeight: add.fontWeight || 'normal',
              color: add.color || '#000000',
            });
          }
        }

        if (change.modifications.length > 0 || change.additions.length > 0) {
          changes.push(change);
        }
      }

      if (changes.length === 0) {
        if (window.showToast) window.showToast('Nenhuma alteracao para salvar.', 'info');
        resetSaveBtn();
        return;
      }

      const response = await fetch('/api/pdf-editor/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfId, changes }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Erro ao salvar.');
      }

      showDownloadModal(data.downloadUrl, data.filename);

    } catch (err) {
      console.error('Save error:', err);
      if (window.showToast) window.showToast(err.message || 'Erro ao salvar PDF.', 'error');
    } finally {
      resetSaveBtn();
    }
  }

  function resetSaveBtn() {
    const saveBtn = document.getElementById('peSaveBtn');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<span class="material-symbols-outlined">download</span> Salvar PDF';
    }
  }

  // ─── Download Modal ─────────────────────────────────────────
  function showDownloadModal(downloadUrl, filename) {
    const existing = document.querySelector('.pe-download-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'pe-download-modal';
    modal.innerHTML = `
      <div class="pe-download-card">
        <span class="material-symbols-outlined">check_circle</span>
        <h3 class="pe-download-title">PDF editado com sucesso!</h3>
        <p class="pe-download-subtitle">Seu arquivo esta pronto para download.</p>
        <a href="${escapeAttr(downloadUrl)}" download="${escapeAttr(filename)}" class="pe-download-btn">
          <span class="material-symbols-outlined">download</span>
          Baixar PDF
        </a>
        <button class="pe-download-close" id="peDownloadClose">Continuar editando</button>
      </div>
    `;

    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
    document.getElementById('peDownloadClose').addEventListener('click', () => modal.remove());
  }

  // ─── AI Assistant Panel ─────────────────────────────────────

  let aiPanelOpen = false;

  function toggleAiPanel() {
    const existing = document.querySelector('.pe-ai-panel');
    if (existing) {
      existing.remove();
      aiPanelOpen = false;
      return;
    }
    openAiPanel();
  }

  function openAiPanel() {
    const existing = document.querySelector('.pe-ai-panel');
    if (existing) existing.remove();

    // Get text from active element or page context
    let selectedText = '';
    if (activeElement) {
      if (activeElement.classList.contains('pe-new-text-editable')) {
        selectedText = activeElement.textContent.replace(/\u200B/g, '').trim();
      } else if (activeElement.classList.contains('pe-text-block')) {
        selectedText = activeElement.textContent.trim();
      }
    }

    // If no active element, gather all visible text from current page
    let pageContext = '';
    const textLayer = document.querySelector('.pe-text-layer');
    if (textLayer) {
      const blocks = textLayer.querySelectorAll('.pe-text-block');
      const texts = [];
      blocks.forEach(b => {
        const t = b.textContent.trim();
        if (t) texts.push(t);
      });
      pageContext = texts.join(' ');
    }

    const panel = document.createElement('div');
    panel.className = 'pe-ai-panel';
    panel.innerHTML = `
      <div class="pe-ai-panel-header">
        <span class="material-symbols-outlined">auto_awesome</span>
        <span>Assistente IA</span>
        <button class="pe-ai-close" id="peAiClose" title="Fechar">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="pe-ai-panel-body">
        <label class="pe-ai-label">Texto selecionado</label>
        <textarea class="pe-ai-input" id="peAiInput" rows="4" placeholder="Selecione um texto no PDF ou digite aqui...">${escapeHtml(selectedText)}</textarea>
        <label class="pe-ai-label">Acao</label>
        <div class="pe-ai-actions">
          <button class="pe-ai-action-btn" data-action="improve">
            <span class="material-symbols-outlined">trending_up</span> Melhorar
          </button>
          <button class="pe-ai-action-btn" data-action="fix_grammar">
            <span class="material-symbols-outlined">spellcheck</span> Corrigir
          </button>
          <button class="pe-ai-action-btn" data-action="rewrite">
            <span class="material-symbols-outlined">edit_note</span> Reescrever
          </button>
          <button class="pe-ai-action-btn" data-action="summarize">
            <span class="material-symbols-outlined">summarize</span> Resumir
          </button>
          <button class="pe-ai-action-btn" data-action="expand">
            <span class="material-symbols-outlined">expand</span> Expandir
          </button>
          <button class="pe-ai-action-btn" data-action="formalize">
            <span class="material-symbols-outlined">business_center</span> Formalizar
          </button>
        </div>
        <div class="pe-ai-result-area" id="peAiResultArea" style="display:none;">
          <label class="pe-ai-label">Resultado</label>
          <textarea class="pe-ai-result" id="peAiResult" rows="4" readonly></textarea>
          <div class="pe-ai-result-actions">
            <button class="pe-ai-apply-btn" id="peAiApply">
              <span class="material-symbols-outlined">check</span> Aplicar
            </button>
            <button class="pe-ai-copy-btn" id="peAiCopy">
              <span class="material-symbols-outlined">content_copy</span> Copiar
            </button>
          </div>
        </div>
        <div class="pe-ai-loading" id="peAiLoading" style="display:none;">
          <div class="pe-ai-spinner"></div>
          <span>Processando com IA...</span>
        </div>
        <div class="pe-ai-error" id="peAiError" style="display:none;"></div>
      </div>
    `;

    document.getElementById('pdfEditorOverlay').appendChild(panel);
    aiPanelOpen = true;

    // Bind events
    document.getElementById('peAiClose').addEventListener('click', () => {
      panel.remove();
      aiPanelOpen = false;
    });

    panel.querySelectorAll('.pe-ai-action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const text = document.getElementById('peAiInput').value.trim();
        if (!text) {
          if (window.showToast) window.showToast('Digite ou selecione um texto primeiro.', 'info');
          return;
        }
        runAiAssist(text, action, pageContext);
      });
    });

    document.getElementById('peAiApply').addEventListener('click', () => {
      const result = document.getElementById('peAiResult').value;
      if (!result) return;
      applyAiResult(result);
    });

    document.getElementById('peAiCopy').addEventListener('click', () => {
      const result = document.getElementById('peAiResult').value;
      if (!result) return;
      navigator.clipboard.writeText(result).then(() => {
        if (window.showToast) window.showToast('Texto copiado!', 'success');
      });
    });
  }

  async function runAiAssist(text, action, context) {
    const loading = document.getElementById('peAiLoading');
    const resultArea = document.getElementById('peAiResultArea');
    const resultEl = document.getElementById('peAiResult');
    const errorEl = document.getElementById('peAiError');

    loading.style.display = 'flex';
    resultArea.style.display = 'none';
    errorEl.style.display = 'none';

    try {
      const response = await fetch('/api/pdf-editor/ai-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, action, context }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Erro ao processar com IA.');
      }

      resultEl.value = data.result;
      resultArea.style.display = 'block';
    } catch (err) {
      errorEl.textContent = err.message || 'Erro ao conectar com a IA.';
      errorEl.style.display = 'block';
    } finally {
      loading.style.display = 'none';
    }
  }

  function applyAiResult(text) {
    if (!activeElement) {
      if (window.showToast) window.showToast('Selecione um elemento de texto para aplicar.', 'info');
      return;
    }

    if (activeElement.classList.contains('pe-text-block')) {
      activeElement.textContent = text;
      activeElement.classList.add('modified');
      activeElement.style.color = activeElement.dataset.fontColor || '#000000';

      const pageNum = parseInt(activeElement.dataset.page, 10);
      const blockId = activeElement.dataset.blockId;
      if (!modifications[pageNum]) modifications[pageNum] = {};
      modifications[pageNum][blockId] = {
        originalText: activeElement.dataset.origText,
        newText: text,
        x: parseFloat(activeElement.dataset.pdfX),
        y: parseFloat(activeElement.dataset.pdfY),
        width: parseFloat(activeElement.dataset.pdfWidth),
        height: parseFloat(activeElement.dataset.pdfHeight),
        fontSize: parseFloat(activeElement.dataset.fontSize) || 12,
        fontName: activeElement.dataset.fontName || '',
        fontWeight: activeElement.style.fontWeight || 'normal',
        fontStyle: activeElement.style.fontStyle || 'normal',
        fontFamily: activeElement.style.fontFamily || 'sans-serif',
        color: activeElement.dataset.fontColor || '#000000',
      };
    } else if (activeElement.classList.contains('pe-new-text-editable')) {
      activeElement.textContent = text;
      const wrapper = activeElement.closest('.pe-new-text');
      if (wrapper) {
        const pageNum = parseInt(wrapper.dataset.page, 10);
        const idx = parseInt(wrapper.dataset.idx, 10);
        if (additions[pageNum] && additions[pageNum][idx]) {
          additions[pageNum][idx].text = text;
        }
      }
    }

    if (window.showToast) window.showToast('Texto aplicado!', 'success');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── Close Editor ───────────────────────────────────────────
  function closeEditor() {
    const overlay = document.getElementById('pdfEditorOverlay');
    if (overlay) {
      overlay.style.animation = 'none';
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.2s ease';
      setTimeout(() => overlay.remove(), 200);
    }

    pdfDoc = null;
    pdfId = null;
    fontData = null;
    activeElement = null;
    currentPage = 1;
    totalPages = 0;
    currentZoom = RENDER_SCALE;
    Object.keys(pageData).forEach(k => delete pageData[k]);
    Object.keys(modifications).forEach(k => delete modifications[k]);
    Object.keys(additions).forEach(k => delete additions[k]);

    if (typeof window.resetUploadForEditor === 'function') {
      window.resetUploadForEditor();
    }
  }

  // ─── Utils ──────────────────────────────────────────────────
  function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (!document.getElementById('pdfEditorOverlay')) return;

    // Ctrl/Cmd + S to save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveEdits();
    }

    // Ctrl/Cmd + B to toggle bold
    if ((e.ctrlKey || e.metaKey) && e.key === 'b' && activeElement) {
      e.preventDefault();
      document.getElementById('peBold').click();
    }

    // Ctrl/Cmd + I to toggle italic
    if ((e.ctrlKey || e.metaKey) && e.key === 'i' && activeElement) {
      e.preventDefault();
      document.getElementById('peItalic').click();
    }

    // Ctrl/Cmd + Z to undo (only when not editing text)
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.target.closest('.pe-text-block, .pe-new-text')) {
      e.preventDefault();
      undoPage();
    }
  });

})();
