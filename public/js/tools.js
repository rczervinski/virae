/**
 * tools.js — Logica especifica de cada ferramenta.
 * Gerencia opcoes (select, range, checkbox) e ajustes por categoria.
 * Vanilla JS (ES6+), sem dependencias externas.
 * Textos em PT-BR.
 */

(() => {
  'use strict';

  // ─── Elementos ─────────────────────────────────────────────────
  const optionsContainer = document.querySelector('#tool-options');
  const processBtn = document.querySelector('#process-btn');

  // ─── Inicializacao ─────────────────────────────────────────────
  const init = () => {
    if (optionsContainer) initOptions();
    initCategoryUI();
  };

  // ─── Opcoes da ferramenta ──────────────────────────────────────
  const initOptions = () => {
    // Range inputs: mostrar valor atual
    const rangeInputs = optionsContainer.querySelectorAll('input[type="range"]');
    rangeInputs.forEach((input) => {
      const valueDisplay = input.parentElement.querySelector('.range-value') ||
        input.nextElementSibling;

      const updateValue = () => {
        if (valueDisplay) {
          valueDisplay.textContent = input.value;
        }
      };

      input.addEventListener('input', updateValue);
      updateValue();
    });

    // Select inputs: atualizar estado visual
    const selectInputs = optionsContainer.querySelectorAll('select');
    selectInputs.forEach((select) => {
      select.addEventListener('change', () => {
        select.classList.toggle('has-value', select.value !== '');
      });

      // Estado inicial
      if (select.value) {
        select.classList.add('has-value');
      }
    });

    // Checkboxes: toggle de classes visuais
    const checkboxInputs = optionsContainer.querySelectorAll('input[type="checkbox"]');
    checkboxInputs.forEach((checkbox) => {
      const label = checkbox.closest('label') || checkbox.parentElement;

      checkbox.addEventListener('change', () => {
        label.classList.toggle('checked', checkbox.checked);
      });

      // Estado inicial
      if (checkbox.checked) {
        label.classList.add('checked');
      }
    });

    // Number inputs: validacao min/max
    const numberInputs = optionsContainer.querySelectorAll('input[type="number"]');
    numberInputs.forEach((input) => {
      input.addEventListener('change', () => {
        const min = parseFloat(input.min);
        const max = parseFloat(input.max);
        let val = parseFloat(input.value);

        if (!isNaN(min) && val < min) val = min;
        if (!isNaN(max) && val > max) val = max;
        if (!isNaN(val)) input.value = val;
      });
    });
  };

  /**
   * Coleta todas as opcoes do formulario em um objeto simples.
   * Pode ser usado por outros scripts antes do envio.
   */
  const collectOptions = () => {
    const options = {};
    if (!optionsContainer) return options;

    const inputs = optionsContainer.querySelectorAll('input, select, textarea');
    inputs.forEach((input) => {
      if (!input.name) return;

      if (input.type === 'checkbox') {
        options[input.name] = input.checked;
      } else if (input.type === 'radio') {
        if (input.checked) options[input.name] = input.value;
      } else {
        options[input.name] = input.value;
      }
    });

    return options;
  };

  // Expor para uso pelo upload.js e outros scripts
  window.collectToolOptions = collectOptions;

  // ─── Ajustes de UI por categoria ───────────────────────────────
  const initCategoryUI = () => {
    const toolSlug = document.body.dataset.toolSlug || '';
    const toolCategory = document.body.dataset.toolCategory || '';

    switch (toolCategory) {
      case 'pdf':
        initPdfUI();
        break;
      case 'image':
        initImageUI();
        break;
      case 'gif':
        initGifUI();
        break;
      case 'audio':
        initAudioUI();
        break;
      case 'video':
        initVideoUI();
        break;
      case 'convert':
        initConvertUI();
        break;
      case 'ai':
        initAiUI();
        break;
    }
  };

  // ─── PDF ───────────────────────────────────────────────────────
  const initPdfUI = () => {
    // Verificar se a ferramenta precisa de multiplos arquivos (merge)
    const fileInput = document.querySelector('#file-input');
    const toolSlug = document.body.dataset.toolSlug || '';

    if (toolSlug === 'merge-pdf' && fileInput) {
      fileInput.setAttribute('multiple', 'true');
      const uploadText = document.querySelector('.upload-text');
      if (uploadText) {
        uploadText.textContent = 'Arraste seus PDFs aqui (multiplos arquivos)';
      }
    }

    // Split PDF: opcoes de paginas
    if (toolSlug === 'split-pdf') {
      addPageRangeHelper();
    }
  };

  const addPageRangeHelper = () => {
    const pagesInput = optionsContainer?.querySelector('[name="pages"]');
    if (!pagesInput) return;

    const helper = document.createElement('small');
    helper.className = 'option-helper';
    helper.textContent = 'Ex: 1-3, 5, 7-10';
    pagesInput.parentElement.appendChild(helper);
  };

  // ─── Imagem ────────────────────────────────────────────────────
  const initImageUI = () => {
    // Preview da imagem apos selecao
    const uploadArea = document.querySelector('.upload-area');
    if (!uploadArea) return;

    const observer = new MutationObserver(() => {
      const fileInfo = uploadArea.querySelector('.file-selected-name');
      if (fileInfo) {
        const fileInput = document.querySelector('#file-input');
        if (fileInput?.files?.[0] && fileInput.files[0].type.startsWith('image/')) {
          addImagePreview(fileInput.files[0], uploadArea);
        }
      }
    });

    observer.observe(uploadArea, { childList: true, subtree: true });
  };

  const addImagePreview = (file, container) => {
    if (container.querySelector('.image-preview')) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const preview = document.createElement('div');
      preview.className = 'image-preview';
      preview.innerHTML = `<img src="${e.target.result}" alt="Preview" />`;

      const selectedInfo = container.querySelector('.file-selected');
      if (selectedInfo) {
        selectedInfo.insertBefore(preview, selectedInfo.firstChild);
      }
    };
    reader.readAsDataURL(file);
  };

  // ─── GIF ───────────────────────────────────────────────────────
  const initGifUI = () => {
    const toolSlug = document.body.dataset.toolSlug || '';

    // GIF Maker: multiplos arquivos
    if (toolSlug === 'gif-maker') {
      const fileInput = document.querySelector('#file-input');
      if (fileInput) {
        fileInput.setAttribute('multiple', 'true');
        const uploadText = document.querySelector('.upload-text');
        if (uploadText) {
          uploadText.textContent = 'Arraste suas imagens aqui (multiplas)';
        }
      }
    }
  };

  // ─── Audio ─────────────────────────────────────────────────────
  const initAudioUI = () => {
    const toolSlug = document.body.dataset.toolSlug || '';

    // Juntar audios: multiplos arquivos
    if (toolSlug === 'juntar-audios') {
      const fileInput = document.querySelector('#file-input');
      if (fileInput) {
        fileInput.setAttribute('multiple', 'true');
        const uploadText = document.querySelector('.upload-text');
        if (uploadText) {
          uploadText.textContent = 'Arraste seus arquivos de audio aqui (multiplos)';
        }
      }
    }

    // Gravador de audio
    if (toolSlug === 'gravar-audio') {
      initAudioRecorder();
    }
  };

  const initAudioRecorder = () => {
    const uploadArea = document.querySelector('.upload-area');
    if (!uploadArea) return;

    uploadArea.innerHTML = `
      <div class="recorder-ui">
        <button type="button" class="btn btn-record" id="record-btn">
          🎙️ Iniciar gravacao
        </button>
        <div class="recorder-timer" id="recorder-timer" style="display: none;">00:00</div>
        <button type="button" class="btn btn-stop" id="stop-btn" style="display: none;">
          ⏹ Parar gravacao
        </button>
      </div>
    `;

    let mediaRecorder = null;
    let audioChunks = [];
    let timerInterval = null;
    let seconds = 0;

    const recordBtn = document.querySelector('#record-btn');
    const stopBtn = document.querySelector('#stop-btn');
    const timerDisplay = document.querySelector('#recorder-timer');

    recordBtn.addEventListener('click', async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        seconds = 0;

        mediaRecorder.addEventListener('dataavailable', (e) => {
          audioChunks.push(e.data);
        });

        mediaRecorder.addEventListener('stop', () => {
          clearInterval(timerInterval);
          stream.getTracks().forEach((t) => t.stop());

          const blob = new Blob(audioChunks, { type: 'audio/webm' });
          const file = new File([blob], 'gravacao.webm', { type: 'audio/webm' });

          // Disparar evento customizado para o upload.js capturar
          const event = new CustomEvent('audioRecorded', { detail: { file } });
          document.dispatchEvent(event);
        });

        mediaRecorder.start();
        recordBtn.style.display = 'none';
        stopBtn.style.display = '';
        timerDisplay.style.display = '';

        timerInterval = setInterval(() => {
          seconds++;
          const min = String(Math.floor(seconds / 60)).padStart(2, '0');
          const sec = String(seconds % 60).padStart(2, '0');
          timerDisplay.textContent = `${min}:${sec}`;
        }, 1000);
      } catch {
        if (window.showToast) {
          window.showToast('Nao foi possivel acessar o microfone.', 'error');
        }
      }
    });

    stopBtn.addEventListener('click', () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        recordBtn.style.display = '';
        stopBtn.style.display = 'none';
        recordBtn.textContent = '🎙️ Gravar novamente';
      }
    });
  };

  // ─── Video ─────────────────────────────────────────────────────
  const initVideoUI = () => {
    const toolSlug = document.body.dataset.toolSlug || '';

    // Juntar videos: multiplos arquivos
    if (toolSlug === 'juntar-videos') {
      const fileInput = document.querySelector('#file-input');
      if (fileInput) {
        fileInput.setAttribute('multiple', 'true');
        const uploadText = document.querySelector('.upload-text');
        if (uploadText) {
          uploadText.textContent = 'Arraste seus videos aqui (multiplos)';
        }
      }
    }
  };

  // ─── Converter ─────────────────────────────────────────────────
  const initConvertUI = () => {
    // Sem ajustes especificos por enquanto
  };

  // ─── IA ────────────────────────────────────────────────────────
  const initAiUI = () => {
    const toolSlug = document.body.dataset.toolSlug || '';

    // Chat com PDF: interface de chat
    if (toolSlug === 'chat-pdf') {
      initChatInterface();
    }
  };

  const initChatInterface = () => {
    const resultArea = document.querySelector('.result-area');
    if (!resultArea) return;

    // O chat sera inicializado apos o upload do arquivo
    document.addEventListener('fileProcessed', (e) => {
      const { sessionId } = e.detail || {};
      if (!sessionId) return;

      resultArea.innerHTML = `
        <div class="chat-container">
          <div class="chat-messages" id="chat-messages"></div>
          <div class="chat-input-area">
            <input type="text" id="chat-input" class="chat-input"
                   placeholder="Faca uma pergunta sobre o documento..." />
            <button type="button" class="btn btn-primary" id="chat-send-btn">Enviar</button>
          </div>
        </div>
      `;

      resultArea.classList.add('active');

      const chatInput = document.querySelector('#chat-input');
      const sendBtn = document.querySelector('#chat-send-btn');
      const messagesEl = document.querySelector('#chat-messages');

      const sendMessage = async () => {
        const text = chatInput.value.trim();
        if (!text) return;

        appendMessage(messagesEl, text, 'user');
        chatInput.value = '';
        sendBtn.disabled = true;

        try {
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, message: text })
          });
          const data = await res.json();
          appendMessage(messagesEl, data.reply || 'Sem resposta.', 'assistant');
        } catch {
          appendMessage(messagesEl, 'Erro ao enviar mensagem.', 'error');
        }

        sendBtn.disabled = false;
        chatInput.focus();
      };

      sendBtn.addEventListener('click', sendMessage);
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendMessage();
      });
    });
  };

  const appendMessage = (container, text, role) => {
    const msg = document.createElement('div');
    msg.className = `chat-message chat-message--${role}`;
    msg.textContent = text;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
  };

  // ─── Boot ──────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
