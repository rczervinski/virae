/**
 * upload.js — Handler de upload, drag & drop, progresso, preview e resultado.
 * Vanilla JS (ES6+), sem dependencias externas.
 * Textos em PT-BR.
 */

(() => {
  'use strict';

  const DEFAULT_MAX_SIZE = 52428800; // 50 MB
  const TOAST_DURATION = 5000;

  // ─── Elementos (IDs e classes do template EJS) ──────────────
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');
  const processBtn = document.getElementById('btnProcess');
  const resultSection = document.getElementById('toolResult');
  const searchInput = document.getElementById('toolSearch');

  // Elementos de resultado
  const resultFilename = document.getElementById('resultFilename');
  const resultOriginalSize = document.getElementById('resultOriginalSize');
  const resultNewSize = document.getElementById('resultNewSize');
  const resultReduction = document.getElementById('resultReduction');
  const resultDownload = document.getElementById('resultDownload');
  const resultProcessAnother = document.getElementById('resultProcessAnother');

  // Guardar HTML original do upload area para reset
  const uploadAreaOriginalHTML = uploadArea ? uploadArea.innerHTML : '';

  let selectedFile = null;
  // Multi-file support for merge-pdf
  let selectedFiles = [];
  const isMergePdf = processBtn && processBtn.dataset.slug === 'merge-pdf';
  // Rastrear object URLs para revogar ao limpar (evitar memory leak)
  let activeObjectURLs = [];

  // Signature pad
  const signatureCanvas = document.getElementById('signatureCanvas');

  // ─── Inicializacao ──────────────────────────────────────────
  const init = () => {
    if (uploadArea) initUpload();
    if (searchInput) initSearch();
    if (resultProcessAnother) {
      resultProcessAnother.addEventListener('click', resetUpload);
    }
    initRangeInputs();
    if (signatureCanvas) initSignaturePad();
  };

  // ─── Drag & Drop + Click ────────────────────────────────────
  const initUpload = () => {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((evt) => {
      uploadArea.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    uploadArea.addEventListener('dragenter', () => {
      uploadArea.classList.add('drag-over');
    });

    uploadArea.addEventListener('dragover', () => {
      uploadArea.classList.add('drag-over');
    });

    uploadArea.addEventListener('dragleave', (e) => {
      if (!uploadArea.contains(e.relatedTarget)) {
        uploadArea.classList.remove('drag-over');
      }
    });

    uploadArea.addEventListener('drop', (e) => {
      uploadArea.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (isMergePdf) {
        if (files.length > 0) handleMergeFileSelection(files);
      } else {
        if (files.length > 0) handleFileSelection(files[0]);
      }
    });

    // Click para abrir seletor
    uploadArea.addEventListener('click', (e) => {
      if (e.target.closest('.file-remove-btn')) return;
      if (e.target.closest('.merge-file-remove')) return;
      if (e.target.closest('.merge-file-item')) return;
      if (fileInput) fileInput.click();
    });

    if (fileInput) {
      // Enable multiple selection for merge-pdf
      if (isMergePdf) fileInput.multiple = true;

      fileInput.addEventListener('change', () => {
        if (isMergePdf) {
          if (fileInput.files.length > 0) handleMergeFileSelection(fileInput.files);
        } else {
          if (fileInput.files.length > 0) handleFileSelection(fileInput.files[0]);
        }
      });
    }

    // Botao processar
    if (processBtn) {
      processBtn.addEventListener('click', handleProcess);
    }
  };

  // ─── Selecao de Arquivo ─────────────────────────────────────
  const handleFileSelection = (file) => {
    // Validar tipo
    const acceptAttr = (fileInput && fileInput.getAttribute('accept')) || '';
    if (acceptAttr) {
      const allowedExts = acceptAttr.split(',').map((ext) => ext.trim().toLowerCase());
      const fileExt = '.' + file.name.split('.').pop().toLowerCase();
      if (allowedExts.length > 0 && allowedExts[0] !== '' && !allowedExts.includes(fileExt)) {
        showToast(`Formato nao permitido. Aceitos: ${allowedExts.join(', ')}`, 'error');
        return;
      }
    }

    // Validar tamanho
    const maxSize = parseInt(uploadArea.dataset.maxSize, 10) || DEFAULT_MAX_SIZE;
    if (file.size > maxSize) {
      const maxMb = (maxSize / (1024 * 1024)).toFixed(0);
      showToast(`Arquivo muito grande. Maximo: ${maxMb}MB`, 'error');
      return;
    }

    selectedFile = file;
    showFileInfo(file);
  };

  // ─── Multi-file selection for merge-pdf ─────────────────────
  const handleMergeFileSelection = (fileList) => {
    const acceptAttr = (fileInput && fileInput.getAttribute('accept')) || '';
    const allowedExts = acceptAttr ? acceptAttr.split(',').map(ext => ext.trim().toLowerCase()) : [];
    const maxSize = parseInt(uploadArea.dataset.maxSize, 10) || DEFAULT_MAX_SIZE;

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];

      // Validate type
      if (allowedExts.length > 0 && allowedExts[0] !== '') {
        const fileExt = '.' + file.name.split('.').pop().toLowerCase();
        if (!allowedExts.includes(fileExt)) {
          showToast(`Formato nao permitido: ${file.name}. Aceitos: ${allowedExts.join(', ')}`, 'error');
          continue;
        }
      }

      // Validate size
      if (file.size > maxSize) {
        const maxMb = (maxSize / (1024 * 1024)).toFixed(0);
        showToast(`Arquivo muito grande: ${file.name}. Maximo: ${maxMb}MB`, 'error');
        continue;
      }

      // Check max 20 files
      if (selectedFiles.length >= 20) {
        showToast('Maximo de 20 arquivos atingido.', 'error');
        break;
      }

      selectedFiles.push(file);
    }

    // Reset input so re-selecting same files works
    if (fileInput) fileInput.value = '';

    renderMergeFileList();
  };

  const renderMergeFileList = () => {
    if (selectedFiles.length === 0) {
      uploadArea.innerHTML = uploadAreaOriginalHTML;
      uploadArea.classList.remove('has-file');
      return;
    }

    let html = '<div class="merge-file-list">';
    selectedFiles.forEach((file, idx) => {
      html += `
        <div class="merge-file-item" draggable="true" data-idx="${idx}">
          <span class="merge-file-handle material-symbols-outlined" title="Arrastar para reordenar">drag_indicator</span>
          <span class="material-symbols-outlined merge-file-icon">picture_as_pdf</span>
          <span class="merge-file-name" title="${escapeAttr(file.name)}">${escapeHtml(file.name)}</span>
          <span class="merge-file-size">${formatFileSize(file.size)}</span>
          <button type="button" class="merge-file-remove" data-idx="${idx}" title="Remover arquivo">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      `;
    });
    html += '</div>';
    html += `
      <button type="button" class="merge-add-more" id="mergeAddMore">
        <span class="material-symbols-outlined">add</span> Adicionar mais arquivos
      </button>
    `;

    uploadArea.innerHTML = html;
    uploadArea.classList.add('has-file');

    // Remove buttons
    uploadArea.querySelectorAll('.merge-file-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        selectedFiles.splice(idx, 1);
        renderMergeFileList();
      });
    });

    // Add more button
    const addMoreBtn = document.getElementById('mergeAddMore');
    if (addMoreBtn) {
      addMoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (fileInput) fileInput.click();
      });
    }

    // Drag and drop reorder
    initMergeDragDrop();
  };

  const initMergeDragDrop = () => {
    const items = uploadArea.querySelectorAll('.merge-file-item');
    let dragIdx = null;

    items.forEach(item => {
      item.addEventListener('dragstart', (e) => {
        dragIdx = parseInt(item.dataset.idx, 10);
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragIdx);
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        dragIdx = null;
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          item.style.borderTop = '2px solid var(--color-primary)';
          item.style.borderBottom = '';
        } else {
          item.style.borderBottom = '2px solid var(--color-primary)';
          item.style.borderTop = '';
        }
      });

      item.addEventListener('dragleave', () => {
        item.style.borderTop = '';
        item.style.borderBottom = '';
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.style.borderTop = '';
        item.style.borderBottom = '';
        const dropIdx = parseInt(item.dataset.idx, 10);
        if (dragIdx === null || dragIdx === dropIdx) return;

        // Reorder array
        const [moved] = selectedFiles.splice(dragIdx, 1);
        selectedFiles.splice(dropIdx, 0, moved);
        renderMergeFileList();
      });
    });
  };

  // ─── Criar Object URL rastreada ─────────────────────────────
  const createTrackedObjectURL = (file) => {
    const url = URL.createObjectURL(file);
    activeObjectURLs.push(url);
    return url;
  };

  // ─── Revogar todas as object URLs ativas ────────────────────
  const revokeAllObjectURLs = () => {
    activeObjectURLs.forEach((url) => {
      try { URL.revokeObjectURL(url); } catch (e) { /* ignora */ }
    });
    activeObjectURLs = [];
  };

  // ─── Exibir info do arquivo selecionado com preview ─────────
  const showFileInfo = (file) => {
    // Revogar URLs anteriores antes de criar novas
    revokeAllObjectURLs();

    const size = formatFileSize(file.size);
    const type = file.type;
    let previewHTML = '';

    if (type.startsWith('image/') || type === 'image/gif') {
      const url = createTrackedObjectURL(file);
      previewHTML = `<img src="${url}" class="file-preview-img" alt="Preview">`;
    } else if (type.startsWith('audio/')) {
      const url = createTrackedObjectURL(file);
      previewHTML = `<audio controls src="${url}" class="file-preview-audio"></audio>`;
    } else if (type.startsWith('video/')) {
      const url = createTrackedObjectURL(file);
      previewHTML = `<video controls muted src="${url}" class="file-preview-video"></video>`;
    } else if (type === 'application/pdf') {
      previewHTML = `<canvas id="pdfPreviewCanvas" class="file-preview-pdf-canvas"></canvas><span class="file-preview-pdf-info" id="pdfPageInfo"></span>`;
      // Render PDF thumbnail after DOM update
      setTimeout(() => renderPdfPreview(file), 50);
    } else {
      previewHTML = `<span class="material-symbols-outlined file-selected-icon">description</span>`;
    }

    uploadArea.innerHTML = `
      <div class="file-selected">
        <div class="file-preview">${previewHTML}</div>
        <div class="file-selected-info">
          <span class="file-selected-name">${escapeHtml(file.name)}</span>
          <span class="file-selected-size">${size}</span>
        </div>
        <button type="button" class="file-remove-btn" title="Remover arquivo">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    `;

    uploadArea.classList.add('has-file');

    // Capturar duracao de audio/video apos carregamento
    if (type.startsWith('audio/')) {
      const audioEl = uploadArea.querySelector('.file-preview-audio');
      if (audioEl) {
        audioEl.addEventListener('loadedmetadata', () => {
          const duration = formatDuration(audioEl.duration);
          const sizeSpan = uploadArea.querySelector('.file-selected-size');
          if (sizeSpan) sizeSpan.textContent = `${size} — ${duration}`;
        });
      }
    } else if (type.startsWith('video/')) {
      const videoEl = uploadArea.querySelector('.file-preview-video');
      if (videoEl) {
        videoEl.addEventListener('loadedmetadata', () => {
          const duration = formatDuration(videoEl.duration);
          const sizeSpan = uploadArea.querySelector('.file-selected-size');
          if (sizeSpan) sizeSpan.textContent = `${size} — ${duration}`;
        });
      }
    }

    const removeBtn = uploadArea.querySelector('.file-remove-btn');
    if (removeBtn) {
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        resetUpload();
      });
    }
  };

  // ─── Reset ──────────────────────────────────────────────────
  const resetUpload = () => {
    // Revogar object URLs para liberar memoria
    revokeAllObjectURLs();

    selectedFile = null;
    selectedFiles = [];
    if (fileInput) fileInput.value = '';

    // Restaurar HTML original
    if (uploadArea) {
      uploadArea.innerHTML = uploadAreaOriginalHTML;
      uploadArea.classList.remove('has-file');
    }

    // Esconder resultado e limpar preview de resultado
    if (resultSection) {
      resultSection.style.display = 'none';
      const resultPreview = resultSection.querySelector('.result-preview');
      if (resultPreview) resultPreview.remove();
      const multiResult = resultSection.querySelector('.multi-file-result');
      if (multiResult) multiResult.remove();
      // Restaurar visibilidade dos elementos padrao
      const infoEl = resultSection.querySelector('.tool-result-info');
      const actionsEl = resultSection.querySelector('.tool-result-actions');
      if (infoEl) infoEl.style.display = '';
      if (actionsEl) actionsEl.style.display = '';
    }

    // Esconder progress
    hideProgress();

    // Reset botao
    resetProcessBtn();
  };

  // ─── Processar arquivo ──────────────────────────────────────
  const handleProcess = () => {
    // Merge-pdf: multi-file mode
    if (isMergePdf) {
      if (selectedFiles.length < 2) {
        showToast('Selecione pelo menos 2 arquivos PDF para mesclar.', 'error');
        return;
      }
      const formData = new FormData();
      selectedFiles.forEach(file => formData.append('files', file));
      // Send current order as comma-separated indices
      formData.append('order', selectedFiles.map((_, i) => i).join(','));

      // Collect options
      const optionsSection = document.querySelector('.tool-options');
      if (optionsSection) {
        const inputs = optionsSection.querySelectorAll('select, input[type="range"], input[type="checkbox"], input[type="radio"]:checked, input[type="number"], input[type="text"], input[type="password"], input[type="color"], input[type="hidden"]');
        inputs.forEach((input) => {
          if (!input.name) return;
          if (input.type === 'checkbox') {
            formData.append(input.name, input.checked ? 'true' : 'false');
          } else {
            formData.append(input.name, input.value);
          }
        });
      }

      sendFile('merge-pdf', formData);
      return;
    }

    if (!selectedFile) {
      showToast('Selecione um arquivo primeiro.', 'error');
      return;
    }

    // Pegar slug da URL ou do botao
    const slug = (processBtn && processBtn.dataset.slug) || window.location.pathname.replace(/^\//, '');
    if (!slug) {
      showToast('Erro ao identificar a ferramenta.', 'error');
      return;
    }

    // Validacao de senhas (proteger-pdf)
    const confirmPwdInput = document.getElementById('opt-confirmPassword');
    const pwdInput = document.getElementById('opt-password');
    if (confirmPwdInput && pwdInput && confirmPwdInput.value !== pwdInput.value) {
      showToast('As senhas nao coincidem.', 'error');
      return;
    }
    if (pwdInput && pwdInput.value && pwdInput.value.length < 4) {
      showToast('A senha deve ter pelo menos 4 caracteres.', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('file', selectedFile);

    // Coletar opcoes (selects, inputs, checkboxes da secao .tool-options)
    const optionsSection = document.querySelector('.tool-options');
    if (optionsSection) {
      const inputs = optionsSection.querySelectorAll('select, input[type="range"], input[type="checkbox"], input[type="radio"]:checked, input[type="number"], input[type="text"], input[type="password"], input[type="color"], input[type="hidden"]');
      inputs.forEach((input) => {
        if (!input.name) return;
        if (input.type === 'checkbox') {
          formData.append(input.name, input.checked ? 'true' : 'false');
        } else {
          formData.append(input.name, input.value);
        }
      });
    }

    // Se for assinar-pdf, capturar canvas da assinatura e validar
    if (signatureCanvas && processBtn && processBtn.dataset.slug === 'assinar-pdf') {
      // Check if canvas has any drawing (not just white background)
      const ctx = signatureCanvas.getContext('2d');
      const imgData = ctx.getImageData(0, 0, signatureCanvas.width, signatureCanvas.height).data;
      let hasDrawing = false;
      for (let i = 0; i < imgData.length; i += 4) {
        // Check if pixel is not white (r=255, g=255, b=255)
        if (imgData[i] < 250 || imgData[i + 1] < 250 || imgData[i + 2] < 250) {
          hasDrawing = true;
          break;
        }
      }
      if (!hasDrawing) {
        showToast('Desenhe sua assinatura antes de processar.', 'error');
        return;
      }

      const sigDataInput = document.getElementById('opt-signatureData');
      if (sigDataInput) {
        sigDataInput.value = signatureCanvas.toDataURL('image/png');
        formData.set('signatureData', sigDataInput.value);
      }
    }

    sendFile(slug, formData);
  };

  // ─── Envio com progresso (XHR) ──────────────────────────────
  const sendFile = (slug, formData) => {
    const xhr = new XMLHttpRequest();

    showProgress();
    updateProgress(0, 'Enviando arquivo...');

    if (processBtn) {
      processBtn.disabled = true;
      processBtn.textContent = 'Processando...';
    }

    // Upload progress (0-50%)
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 50);
        updateProgress(pct, `Enviando... ${Math.round((e.loaded / e.total) * 100)}%`);
      }
    });

    // Upload done, processing (50-90%)
    xhr.upload.addEventListener('load', () => {
      updateProgress(50, 'Processando...');
      animateProcessing();
    });

    // Response received
    xhr.addEventListener('load', () => {
      clearProcessingAnimation();

      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          updateProgress(100, 'Concluido!');
          setTimeout(() => {
            hideProgress();
            showResult(data);
            showToast('Download pronto!', 'success');
          }, 400);
        } catch {
          updateProgress(100, 'Concluido!');
          setTimeout(() => {
            hideProgress();
            showToast('Processamento concluido!', 'success');
          }, 400);
        }
      } else {
        hideProgress();
        let msg = 'Erro ao processar arquivo.';
        try {
          const err = JSON.parse(xhr.responseText);
          msg = err.message || msg;
        } catch { /* ignora */ }
        showToast(msg, 'error');
        resetProcessBtn();
      }
    });

    xhr.addEventListener('error', () => {
      clearProcessingAnimation();
      hideProgress();
      showToast('Erro de conexao. Tente novamente.', 'error');
      resetProcessBtn();
    });

    xhr.addEventListener('abort', () => {
      clearProcessingAnimation();
      hideProgress();
      showToast('Upload cancelado.', 'info');
      resetProcessBtn();
    });

    xhr.open('POST', `/api/process/${slug}`);
    xhr.send(formData);
  };

  // ─── Animacao de processamento ──────────────────────────────
  let processingInterval = null;

  const animateProcessing = () => {
    let current = 50;
    processingInterval = setInterval(() => {
      current += 1;
      if (current >= 95) {
        clearInterval(processingInterval);
        processingInterval = null;
        return;
      }
      updateProgress(current, 'Processando...');
    }, 300);
  };

  const clearProcessingAnimation = () => {
    if (processingInterval) {
      clearInterval(processingInterval);
      processingInterval = null;
    }
  };

  // ─── Barra de progresso (criada dinamicamente) ──────────────
  let progressWrapper = null;

  const ensureProgressBar = () => {
    if (progressWrapper) return;
    progressWrapper = document.createElement('div');
    progressWrapper.className = 'progress-wrapper';
    progressWrapper.innerHTML = `
      <div class="progress-bar-track">
        <div class="progress-bar-fill" id="progressFill"></div>
      </div>
      <span class="progress-bar-text" id="progressText">0%</span>
    `;
    progressWrapper.style.display = 'none';

    // Inserir depois do upload area
    const uploadSection = document.getElementById('uploadSection');
    if (uploadSection) {
      uploadSection.after(progressWrapper);
    }
  };

  const showProgress = () => {
    ensureProgressBar();
    if (progressWrapper) progressWrapper.style.display = '';
  };

  const hideProgress = () => {
    if (progressWrapper) progressWrapper.style.display = 'none';
    updateProgress(0, '');
  };

  const updateProgress = (pct, text) => {
    const fill = document.getElementById('progressFill');
    const textEl = document.getElementById('progressText');
    if (fill) fill.style.width = `${pct}%`;
    if (textEl) textEl.textContent = text || `${pct}%`;
  };

  // ─── Area de resultado com preview inteligente ──────────────
  const showResult = (data) => {
    if (!resultSection) return;

    // Multi-file result (split-pdf, pdf-para-imagem)
    if (data.multiFile && data.files && data.files.length > 0) {
      showMultiFileResult(data);
      return;
    }

    const originalSize = selectedFile ? formatFileSize(selectedFile.size) : '—';
    const newSize = data.size ? formatFileSize(data.size) : '—';
    const reduction = (selectedFile && data.size)
      ? Math.round((1 - data.size / selectedFile.size) * 100)
      : 0;
    const downloadUrl = data.downloadUrl || data.url || '#';
    const filename = data.filename || data.name || selectedFile?.name || 'arquivo';

    if (resultFilename) resultFilename.textContent = filename;
    if (resultOriginalSize) resultOriginalSize.textContent = originalSize;
    if (resultNewSize) resultNewSize.textContent = newSize;
    if (resultReduction) resultReduction.textContent = `${reduction}%`;
    if (resultDownload) {
      resultDownload.href = downloadUrl;
      resultDownload.setAttribute('download', filename);
    }

    // Remover preview anterior se existir
    const existingPreview = resultSection.querySelector('.result-preview');
    if (existingPreview) existingPreview.remove();
    const existingMulti = resultSection.querySelector('.multi-file-result');
    if (existingMulti) existingMulti.remove();

    // Mostrar warning do service se existir
    if (data.warning) {
      showToast(data.warning, 'warning');
    }

    // Criar preview do resultado baseado no tipo de arquivo
    const resultPreview = buildResultPreview(data, downloadUrl, filename);
    if (resultPreview) {
      const actionsEl = resultSection.querySelector('.tool-result-actions');
      const cardEl = resultSection.querySelector('.tool-result-card');
      if (actionsEl && cardEl) {
        cardEl.insertBefore(resultPreview, actionsEl);
      } else if (cardEl) {
        cardEl.appendChild(resultPreview);
      }
    }

    resultSection.style.display = 'block';
  };

  // ─── Multi-file result (split, toImage) ───────────────────
  const showMultiFileResult = (data) => {
    const cardEl = resultSection.querySelector('.tool-result-card');
    if (!cardEl) return;

    // Esconder info e download padrao
    const infoEl = resultSection.querySelector('.tool-result-info');
    const actionsEl = resultSection.querySelector('.tool-result-actions');
    if (infoEl) infoEl.style.display = 'none';

    // Remover containers anteriores
    const existing = resultSection.querySelector('.multi-file-result');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.className = 'multi-file-result';

    const title = document.createElement('p');
    title.className = 'multi-file-title';
    title.textContent = `${data.files.length} arquivo(s) gerado(s)`;
    container.appendChild(title);

    const list = document.createElement('div');
    list.className = 'multi-file-list';

    data.files.forEach((file) => {
      const item = document.createElement('div');
      item.className = 'multi-file-item';
      item.innerHTML = `
        <span class="material-symbols-outlined multi-file-icon">description</span>
        <span class="multi-file-name">${escapeHtml(file.filename)}</span>
        ${file.size ? `<span class="multi-file-size">${formatFileSize(file.size)}</span>` : ''}
        <a href="${escapeAttr(file.downloadUrl)}" download="${escapeAttr(file.filename)}" class="multi-file-download">
          <span class="material-symbols-outlined">download</span>
        </a>
      `;
      list.appendChild(item);
    });

    container.appendChild(list);

    // Botao processar outro
    const anotherBtn = document.createElement('button');
    anotherBtn.className = 'btn-secondary';
    anotherBtn.innerHTML = '<span class="material-symbols-outlined">refresh</span> Processar outro arquivo';
    anotherBtn.addEventListener('click', resetUpload);
    container.appendChild(anotherBtn);

    if (actionsEl) actionsEl.style.display = 'none';
    cardEl.appendChild(container);

    resultSection.style.display = 'block';
  };

  // ─── Construir preview do resultado processado ──────────────
  const buildResultPreview = (data, downloadUrl, filename) => {
    if (!downloadUrl || downloadUrl === '#') return null;

    const ext = filename.split('.').pop().toLowerCase();
    const container = document.createElement('div');
    container.className = 'result-preview';

    // Determinar tipo pelo formato retornado ou extensao do arquivo
    const format = (data.format || ext).toLowerCase();
    const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'avif', 'svg'];
    const audioExts = ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'wma'];
    const videoExts = ['mp4', 'mov', 'avi', 'webm', 'mkv', 'flv', 'wmv'];

    if (imageExts.includes(format)) {
      // Preview de imagem com comparacao antes/depois
      let html = `<img src="${escapeAttr(downloadUrl)}" class="result-preview-img" alt="Resultado processado" loading="lazy">`;

      // Se temos o arquivo original e eh imagem, mostrar comparacao
      if (selectedFile && selectedFile.type.startsWith('image/')) {
        const originalUrl = createTrackedObjectURL(selectedFile);
        html = `
          <div class="result-comparison">
            <div class="result-comparison-item">
              <span class="result-comparison-label">Original</span>
              <img src="${originalUrl}" class="result-preview-img" alt="Original" loading="lazy">
            </div>
            <div class="result-comparison-item">
              <span class="result-comparison-label">Processado</span>
              <img src="${escapeAttr(downloadUrl)}" class="result-preview-img" alt="Processado" loading="lazy">
            </div>
          </div>
        `;
      }
      container.innerHTML = html;
    } else if (audioExts.includes(format)) {
      container.innerHTML = `
        <audio controls src="${escapeAttr(downloadUrl)}" class="result-preview-audio" preload="metadata"></audio>
      `;
    } else if (videoExts.includes(format)) {
      container.innerHTML = `
        <video controls muted src="${escapeAttr(downloadUrl)}" class="result-preview-video" preload="metadata"></video>
      `;
    } else {
      // Para PDF e outros: nao criar preview visual, o botao de download basta
      return null;
    }

    return container;
  };

  const resetProcessBtn = () => {
    if (!processBtn) return;
    const slug = processBtn.dataset.slug || '';
    const cat = processBtn.dataset.service || '';
    const catNames = { pdf: 'PDF', image: 'Imagem', gif: 'GIF', audio: 'Audio', video: 'Video', convert: 'Converter', ai: 'IA' };
    processBtn.disabled = false;
    processBtn.textContent = `Processar ${catNames[cat] || ''}`.trim();
  };

  // ─── Toast Notifications ────────────────────────────────────
  const getOrCreateToastContainer = () => {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  };

  const showToast = (message, type = 'info') => {
    const container = getOrCreateToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;

    const iconMap = { success: 'check_circle', error: 'error', info: 'info', warning: 'warning' };
    toast.innerHTML = `
      <span class="material-symbols-outlined toast-icon">${iconMap[type] || 'info'}</span>
      <span class="toast-message">${escapeHtml(message)}</span>
      <button type="button" class="toast-close">
        <span class="material-symbols-outlined">close</span>
      </button>
    `;

    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('toast--visible');
    });

    const dismiss = () => {
      toast.classList.remove('toast--visible');
      setTimeout(() => toast.remove(), 400);
    };

    toast.querySelector('.toast-close').addEventListener('click', dismiss);
    setTimeout(dismiss, TOAST_DURATION);
  };

  window.showToast = showToast;

  // ─── Busca de ferramentas (homepage) ────────────────────────
  const initSearch = () => {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.trim().toLowerCase();
      const cards = document.querySelectorAll('.tool-card');
      const sections = document.querySelectorAll('.category-section');
      let totalVisible = 0;

      cards.forEach((card) => {
        const name = card.dataset.name || '';
        const desc = card.dataset.desc || '';
        const match = !query || name.includes(query) || desc.includes(query);
        card.style.display = match ? '' : 'none';
        if (match) totalVisible++;
      });

      sections.forEach((section) => {
        const visible = section.querySelectorAll('.tool-card:not([style*="display: none"])');
        section.style.display = visible.length > 0 ? '' : 'none';
      });

      let emptyMsg = document.querySelector('.search-empty');
      if (totalVisible === 0 && query) {
        if (!emptyMsg) {
          emptyMsg = document.createElement('p');
          emptyMsg.className = 'search-empty';
          emptyMsg.textContent = 'Nenhuma ferramenta encontrada';
          emptyMsg.style.cssText = 'text-align:center;color:var(--color-on-surface-variant);padding:2rem;';
          searchInput.closest('.index-search-wrapper')?.after(emptyMsg) ||
            searchInput.parentElement.after(emptyMsg);
        }
        emptyMsg.style.display = '';
      } else if (emptyMsg) {
        emptyMsg.style.display = 'none';
      }
    });
  };

  // ─── Range inputs (mostrar valor ao lado) ──────────────────
  const initRangeInputs = () => {
    document.querySelectorAll('.tool-option-range').forEach((range) => {
      const valueSpan = document.getElementById(`${range.id}-value`);
      if (valueSpan) {
        range.addEventListener('input', () => {
          valueSpan.textContent = range.value;
        });
      }
    });
  };

  // ─── Signature Pad ────────────────────────────────────────
  const initSignaturePad = () => {
    const ctx = signatureCanvas.getContext('2d');
    let drawing = false;
    let penColor = '#000000';

    // Fundo branco
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, signatureCanvas.width, signatureCanvas.height);

    const getPos = (e) => {
      const rect = signatureCanvas.getBoundingClientRect();
      const scaleX = signatureCanvas.width / rect.width;
      const scaleY = signatureCanvas.height / rect.height;
      if (e.touches) {
        return {
          x: (e.touches[0].clientX - rect.left) * scaleX,
          y: (e.touches[0].clientY - rect.top) * scaleY
        };
      }
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    };

    const startDraw = (e) => {
      e.preventDefault();
      drawing = true;
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    };

    const draw = (e) => {
      if (!drawing) return;
      e.preventDefault();
      const pos = getPos(e);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = penColor;
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    };

    const stopDraw = () => { drawing = false; };

    signatureCanvas.addEventListener('mousedown', startDraw);
    signatureCanvas.addEventListener('mousemove', draw);
    signatureCanvas.addEventListener('mouseup', stopDraw);
    signatureCanvas.addEventListener('mouseleave', stopDraw);
    signatureCanvas.addEventListener('touchstart', startDraw, { passive: false });
    signatureCanvas.addEventListener('touchmove', draw, { passive: false });
    signatureCanvas.addEventListener('touchend', stopDraw);

    // Clear button
    const clearBtn = document.getElementById('sigClear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, signatureCanvas.width, signatureCanvas.height);
      });
    }

    // Color buttons
    document.querySelectorAll('.signature-pad-btn-color').forEach((btn) => {
      btn.addEventListener('click', () => {
        penColor = btn.dataset.color || '#000000';
        document.querySelectorAll('.signature-pad-btn-color').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  };

  // ─── PDF Preview (usa pdfjs-dist via ESM dynamic import) ───
  const renderPdfPreview = async (file) => {
    const canvas = document.getElementById('pdfPreviewCanvas');
    const infoEl = document.getElementById('pdfPageInfo');
    if (!canvas) return;

    try {
      const pdfjsLib = await import('/vendor/pdfjs/build/pdf.min.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/build/pdf.worker.min.mjs';

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pageCount = pdf.numPages;

      if (infoEl) {
        infoEl.textContent = `${pageCount} pagina${pageCount !== 1 ? 's' : ''}`;
      }

      // Render first page as thumbnail
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const maxW = 220;
      const scale = maxW / viewport.width;
      const scaledViewport = page.getViewport({ scale });

      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;
      canvas.style.display = 'block';

      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
    } catch (e) {
      // Fallback: show icon if pdf.js fails
      canvas.style.display = 'none';
      if (infoEl) infoEl.textContent = '';
      const wrapper = canvas.parentElement;
      if (wrapper) {
        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined file-preview-pdf-icon';
        icon.textContent = 'picture_as_pdf';
        wrapper.insertBefore(icon, canvas);
      }
    }
  };

  // ─── Utilitarios ────────────────────────────────────────────
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  };

  const formatDuration = (seconds) => {
    if (!seconds || !isFinite(seconds)) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const escapeHtml = (str) => {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  };

  const escapeAttr = (str) => {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  // ─── Boot ───────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
