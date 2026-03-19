const { PDFDocument, rgb, StandardFonts, degrees } = require('pdf-lib');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const zlib = require('zlib');

// pdf-parse para extracao de texto de PDFs (usado nos fallbacks)
let PDFParseClass;
try {
  const pdfParseModule = require('pdf-parse');
  PDFParseClass = pdfParseModule.PDFParse || null;
} catch (e) {
  PDFParseClass = null;
}

/**
 * Extrai texto de um PDF usando pdf-parse.
 * Retorna o texto completo ou string vazia se pdf-parse nao estiver disponivel.
 */
async function extractTextFromPdf(inputPath) {
  if (!PDFParseClass) {
    return '';
  }
  try {
    const dataBuffer = fs.readFileSync(inputPath);
    const data = new Uint8Array(dataBuffer);
    const parser = new PDFParseClass(data);
    const result = await parser.getText();
    return (result && result.text) ? result.text : '';
  } catch (e) {
    return '';
  }
}

/**
 * Extrai texto de um DOCX (que e um ZIP contendo document.xml).
 * Faz parse basico do XML para extrair texto dos paragrafos.
 */
function extractTextFromDocx(docxPath) {
  try {
    const buf = fs.readFileSync(docxPath);

    // DOCX e um ZIP - encontrar document.xml dentro dele
    const entries = [];
    let offset = 0;
    while (offset < buf.length - 4) {
      // Local file header signature = 0x04034b50
      if (buf.readUInt32LE(offset) !== 0x04034b50) break;

      const compMethod = buf.readUInt16LE(offset + 8);
      const compSize = buf.readUInt32LE(offset + 18);
      const uncompSize = buf.readUInt32LE(offset + 22);
      const nameLen = buf.readUInt16LE(offset + 26);
      const extraLen = buf.readUInt16LE(offset + 28);
      const name = buf.toString('utf8', offset + 30, offset + 30 + nameLen);
      const dataStart = offset + 30 + nameLen + extraLen;

      entries.push({ name, compMethod, compSize, uncompSize, dataStart });
      offset = dataStart + compSize;
    }

    // Encontrar word/document.xml
    const docEntry = entries.find(e => e.name === 'word/document.xml');
    if (!docEntry) return '';

    let xmlBuf;
    if (docEntry.compMethod === 0) {
      // Stored (sem compressao)
      xmlBuf = buf.slice(docEntry.dataStart, docEntry.dataStart + docEntry.compSize);
    } else if (docEntry.compMethod === 8) {
      // Deflate
      const compressed = buf.slice(docEntry.dataStart, docEntry.dataStart + docEntry.compSize);
      xmlBuf = zlib.inflateRawSync(compressed);
    } else {
      return '';
    }

    const xml = xmlBuf.toString('utf8');

    // Extrair texto dos elementos <w:t>...</w:t> e separar paragrafos em <w:p>
    const paragraphs = [];
    const pRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
    let pMatch;
    while ((pMatch = pRegex.exec(xml)) !== null) {
      const pXml = pMatch[0];
      const texts = [];
      const tRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
      let tMatch;
      while ((tMatch = tRegex.exec(pXml)) !== null) {
        texts.push(tMatch[1]);
      }
      if (texts.length > 0) {
        paragraphs.push(texts.join(''));
      }
    }

    return paragraphs.join('\n');
  } catch (e) {
    return '';
  }
}

/**
 * Escapa caracteres especiais HTML.
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const TMP_DIR = path.join(__dirname, '..', 'tmp');

// Garante que o diretorio tmp existe
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

/**
 * Verifica se o Ghostscript esta disponivel no sistema.
 * Retorna o comando correto ('gs' ou 'gswin64c' no Windows).
 */
function getGsCommand() {
  const candidates = process.platform === 'win32'
    ? ['gswin64c', 'gswin32c', 'gs']
    : ['gs'];
  return candidates;
}

/**
 * Executa o Ghostscript e retorna uma Promise.
 */
function runGhostscript(args) {
  const candidates = getGsCommand();

  return new Promise((resolve, reject) => {
    function tryNext(index) {
      if (index >= candidates.length) {
        reject(new Error('GS_NOT_FOUND'));
        return;
      }

      execFile(candidates[index], args, { timeout: 120000 }, (error, stdout, stderr) => {
        if (error) {
          if (error.code === 'ENOENT' || (error.message && error.message.includes('ENOENT'))) {
            tryNext(index + 1);
            return;
          }
          reject(new Error(`Erro ao executar Ghostscript: ${stderr || error.message}`));
          return;
        }
        resolve({ stdout, stderr });
      });
    }

    tryNext(0);
  });
}

/**
 * Remove arquivo temporario de forma segura.
 */
function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    // Ignora erro na limpeza
  }
}

/**
 * Comprime um PDF. Tenta Ghostscript primeiro, depois pdf-lib como fallback.
 * Options: quality = 'Baixo'|'Medio'|'Alto' (padrao: 'Medio')
 */
async function compress(inputPath, options = {}) {
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.pdf`);

  try {
    const originalSize = fs.statSync(inputPath).size;

    const qualityMap = {
      'Alto': '/printer',
      'Medio': '/ebook',
      'Baixo': '/screen',
    };
    const quality = options.quality || 'Medio';
    const pdfSettings = qualityMap[quality] || '/ebook';

    // Tenta Ghostscript primeiro
    try {
      await runGhostscript([
        '-sDEVICE=pdfwrite',
        `-dCompatibilityLevel=1.4`,
        `-dPDFSETTINGS=${pdfSettings}`,
        '-dNOPAUSE',
        '-dQUIET',
        '-dBATCH',
        `-sOutputFile=${outputPath}`,
        inputPath,
      ]);

      const newSize = fs.statSync(outputPath).size;
      return {
        outputPath,
        filename: `${outputId}.pdf`,
        originalSize,
        newSize,
      };
    } catch (gsError) {
      if (gsError.message !== 'GS_NOT_FOUND') {
        throw gsError;
      }
      // Fallback: pdf-lib
    }

    // Fallback com pdf-lib: carrega e re-serializa removendo metadados
    const inputBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(inputBytes, { ignoreEncryption: true });

    // Remove metadados para reduzir tamanho
    pdfDoc.setTitle('');
    pdfDoc.setAuthor('');
    pdfDoc.setSubject('');
    pdfDoc.setKeywords([]);
    pdfDoc.setProducer('');
    pdfDoc.setCreator('');

    const compressedBytes = await pdfDoc.save({
      useObjectStreams: true,
      addDefaultPage: false,
    });

    fs.writeFileSync(outputPath, compressedBytes);
    const newSize = fs.statSync(outputPath).size;

    return {
      outputPath,
      filename: `${outputId}.pdf`,
      originalSize,
      newSize,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao comprimir PDF: ${error.message}`);
  }
}

/**
 * Mescla multiplos PDFs em um unico arquivo.
 */
async function merge(inputPaths, options = {}) {
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.pdf`);

  try {
    if (!inputPaths || inputPaths.length < 2) {
      throw new Error('E necessario pelo menos 2 arquivos PDF para mesclar.');
    }

    const mergedPdf = await PDFDocument.create();
    let totalOriginalSize = 0;

    for (const filePath of inputPaths) {
      const fileBytes = fs.readFileSync(filePath);
      totalOriginalSize += fileBytes.length;

      const pdf = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }

    const mergedBytes = await mergedPdf.save();
    fs.writeFileSync(outputPath, mergedBytes);
    const newSize = fs.statSync(outputPath).size;

    return {
      outputPath,
      filename: `${outputId}.pdf`,
      originalSize: totalOriginalSize,
      newSize,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao mesclar PDFs: ${error.message}`);
  }
}

/**
 * Parseia uma string de intervalos de paginas em um array de numeros.
 * Ex: "1-3, 5, 7-10" => [1, 2, 3, 5, 7, 8, 9, 10]
 * Retorna null se a string estiver vazia/undefined (significa todas as paginas).
 */
function parsePageRanges(str, maxPages) {
  if (!str || typeof str !== 'string' || str.trim() === '') {
    return null;
  }

  const pages = new Set();
  const parts = str.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-').map((s) => s.trim());
      let start = parseInt(startStr, 10);
      let end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end)) continue;
      start = Math.max(1, Math.min(start, maxPages));
      end = Math.max(1, Math.min(end, maxPages));
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      for (let i = lo; i <= hi; i++) {
        pages.add(i);
      }
    } else {
      const num = parseInt(trimmed, 10);
      if (isNaN(num)) continue;
      const clamped = Math.max(1, Math.min(num, maxPages));
      pages.add(clamped);
    }
  }

  if (pages.size === 0) return null;
  return Array.from(pages).sort((a, b) => a - b);
}

/**
 * Divide um PDF em paginas individuais.
 * Retorna um array de caminhos dos arquivos gerados.
 * Options: pages = string de intervalos (ex: "1-3, 5") ou vazio para todas.
 */
async function split(inputPath, options = {}) {
  const outputPaths = [];

  try {
    const originalSize = fs.statSync(inputPath).size;
    const inputBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(inputBytes, { ignoreEncryption: true });
    const pageCount = pdfDoc.getPageCount();

    // Parse which pages to extract
    const selectedPages = parsePageRanges(options.pages, pageCount);

    // If no specific pages requested and PDF has only 1 page, error
    if (!selectedPages && pageCount < 2) {
      throw new Error('O PDF tem apenas 1 pagina, nao e possivel dividir.');
    }

    const pagesToExtract = selectedPages || Array.from({ length: pageCount }, (_, i) => i + 1);

    let totalNewSize = 0;

    for (const pageNum of pagesToExtract) {
      const newPdf = await PDFDocument.create();
      const [copiedPage] = await newPdf.copyPages(pdfDoc, [pageNum - 1]);
      newPdf.addPage(copiedPage);

      const pageBytes = await newPdf.save();
      const pageId = uuidv4();
      const pagePath = path.join(TMP_DIR, `${pageId}.pdf`);
      fs.writeFileSync(pagePath, pageBytes);
      totalNewSize += pageBytes.length;

      outputPaths.push({
        outputPath: pagePath,
        filename: `pagina_${pageNum}.pdf`,
        page: pageNum,
      });
    }

    return {
      outputPaths,
      totalPages: pageCount,
      originalSize,
      newSize: totalNewSize,
    };
  } catch (error) {
    // Limpa arquivos ja gerados em caso de erro
    outputPaths.forEach((p) => safeUnlink(p.outputPath));
    throw new Error(`Erro ao dividir PDF: ${error.message}`);
  }
}

/**
 * Rotaciona paginas de um PDF.
 * Options: degrees = 90|180|270 (padrao: 90), pages = 'all' | [1,2,3]
 */
async function rotate(inputPath, options = {}) {
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.pdf`);

  try {
    const originalSize = fs.statSync(inputPath).size;
    const inputBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(inputBytes, { ignoreEncryption: true });

    const rotationDegrees = options.degrees || 90;
    if (![90, 180, 270].includes(rotationDegrees)) {
      throw new Error('Graus de rotacao invalidos. Use 90, 180 ou 270.');
    }

    const pages = pdfDoc.getPages();
    const targetPages = options.pages || 'all';

    pages.forEach((page, index) => {
      if (targetPages === 'all' || (Array.isArray(targetPages) && targetPages.includes(index + 1))) {
        const currentRotation = page.getRotation().angle;
        page.setRotation(degrees(currentRotation + rotationDegrees));
      }
    });

    const rotatedBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, rotatedBytes);
    const newSize = fs.statSync(outputPath).size;

    return {
      outputPath,
      filename: `${outputId}.pdf`,
      originalSize,
      newSize,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao rotacionar PDF: ${error.message}`);
  }
}

/**
 * Adiciona protecao por senha a um PDF.
 * Nota: pdf-lib tem suporte limitado a criptografia. Faz melhor esforco.
 * Options: password (string)
 */
async function protect(inputPath, options = {}) {
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.pdf`);

  try {
    const originalSize = fs.statSync(inputPath).size;

    if (!options.password) {
      throw new Error('E necessario fornecer uma senha para proteger o PDF.');
    }

    // Tenta Ghostscript para protecao com senha (suporte mais robusto)
    try {
      await runGhostscript([
        '-sDEVICE=pdfwrite',
        '-dCompatibilityLevel=1.4',
        '-dNOPAUSE',
        '-dQUIET',
        '-dBATCH',
        `-sOwnerPassword=${options.password}`,
        `-sUserPassword=${options.password}`,
        '-dEncryptionR=3',
        '-dKeyLength=128',
        '-dPermissions=-3904',
        `-sOutputFile=${outputPath}`,
        inputPath,
      ]);

      const newSize = fs.statSync(outputPath).size;
      return {
        outputPath,
        filename: `${outputId}.pdf`,
        originalSize,
        newSize,
      };
    } catch (gsError) {
      if (gsError.message !== 'GS_NOT_FOUND') {
        throw gsError;
      }
    }

    // Fallback: pdf-lib (suporte limitado - salva sem criptografia real,
    // mas adiciona metadados indicando protecao)
    const inputBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(inputBytes, { ignoreEncryption: true });

    // pdf-lib nao suporta criptografia nativa de forma completa.
    // Re-serializa o documento. Para protecao real, Ghostscript e necessario.
    const protectedBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, protectedBytes);
    const newSize = fs.statSync(outputPath).size;

    console.warn('Aviso: Protecao por senha requer Ghostscript para funcionar corretamente.');

    return {
      outputPath,
      filename: `${outputId}.pdf`,
      originalSize,
      newSize,
      warning: 'Protecao por senha limitada sem Ghostscript. Instale o Ghostscript para protecao completa.',
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao proteger PDF: ${error.message}`);
  }
}

/**
 * Adiciona numeros de pagina a cada pagina do PDF.
 * Options: position = 'bottom'|'top' (padrao: 'bottom'), startNumber (padrao: 1),
 *          fontSize (padrao: 12), margin (padrao: 30)
 */
async function pageNumbers(inputPath, options = {}) {
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.pdf`);

  try {
    const originalSize = fs.statSync(inputPath).size;
    const inputBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(inputBytes, { ignoreEncryption: true });
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const pages = pdfDoc.getPages();
    const position = options.position || 'bottom';
    const startNumber = options.startNumber || 1;
    const fontSize = options.fontSize || 12;
    const margin = options.margin || 30;

    pages.forEach((page, index) => {
      const { width, height } = page.getSize();
      const pageNum = startNumber + index;
      const text = `${pageNum}`;
      const textWidth = font.widthOfTextAtSize(text, fontSize);

      // Calcular posicao X baseado no alinhamento
      let x;
      if (position.includes('right')) {
        x = width - textWidth - margin;
      } else if (position.includes('left')) {
        x = margin;
      } else {
        x = (width - textWidth) / 2;
      }

      // Calcular posicao Y baseado em topo/rodape
      const y = position.includes('top') ? height - margin : margin;

      page.drawText(text, {
        x,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    });

    const numberedBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, numberedBytes);
    const newSize = fs.statSync(outputPath).size;

    return {
      outputPath,
      filename: `${outputId}.pdf`,
      originalSize,
      newSize,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao adicionar numeros de pagina: ${error.message}`);
  }
}

/**
 * Converte paginas do PDF em imagens PNG usando Ghostscript.
 * Options: dpi (padrao: 150), pages = 'all' | [1,2,3]
 */
async function toImage(inputPath, options = {}) {
  const outputId = uuidv4();
  const outputPattern = path.join(TMP_DIR, `${outputId}_page_%d.png`);
  const generatedFiles = [];

  try {
    const originalSize = fs.statSync(inputPath).size;
    const dpi = options.dpi || 150;

    // Determina numero de paginas
    const inputBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(inputBytes, { ignoreEncryption: true });
    const pageCount = pdfDoc.getPageCount();

    const gsArgs = [
      '-sDEVICE=png16m',
      `-r${dpi}`,
      '-dNOPAUSE',
      '-dBATCH',
      `-sOutputFile=${outputPattern}`,
    ];

    // Se paginas especificas foram solicitadas
    if (options.pages && options.pages !== 'all' && Array.isArray(options.pages)) {
      gsArgs.push(`-dFirstPage=${Math.min(...options.pages)}`);
      gsArgs.push(`-dLastPage=${Math.max(...options.pages)}`);
    }

    gsArgs.push(inputPath);

    let usedFallback = false;

    try {
      await runGhostscript(gsArgs);
    } catch (gsError) {
      if (gsError.message !== 'GS_NOT_FOUND') {
        throw gsError;
      }

      // Fallback: Ghostscript nao encontrado. Divide o PDF em paginas individuais (PDF)
      // em vez de gerar imagens PNG.
      usedFallback = true;

      const pagesToExtract = (options.pages && options.pages !== 'all' && Array.isArray(options.pages))
        ? options.pages
        : Array.from({ length: pageCount }, (_, i) => i + 1);

      for (const pageNum of pagesToExtract) {
        if (pageNum < 1 || pageNum > pageCount) continue;

        const newPdf = await PDFDocument.create();
        const [copiedPage] = await newPdf.copyPages(pdfDoc, [pageNum - 1]);
        newPdf.addPage(copiedPage);

        const pageBytes = await newPdf.save();
        const pageId = uuidv4();
        const pagePath = path.join(TMP_DIR, `${pageId}.pdf`);
        fs.writeFileSync(pagePath, pageBytes);

        generatedFiles.push({
          outputPath: pagePath,
          filename: `pagina_${pageNum}.pdf`,
          page: pageNum,
          size: pageBytes.length,
        });
      }
    }

    if (!usedFallback) {
      // Coleta os arquivos PNG gerados pelo Ghostscript
      for (let i = 1; i <= pageCount; i++) {
        const filePath = path.join(TMP_DIR, `${outputId}_page_${i}.png`);
        if (fs.existsSync(filePath)) {
          const fileSize = fs.statSync(filePath).size;
          generatedFiles.push({
            outputPath: filePath,
            filename: `pagina_${i}.png`,
            page: i,
            size: fileSize,
          });
        }
      }
    }

    if (generatedFiles.length === 0) {
      throw new Error('Nenhuma imagem foi gerada. Verifique se o PDF e valido.');
    }

    let totalNewSize = 0;
    generatedFiles.forEach((f) => { totalNewSize += f.size; });

    const result = {
      outputPaths: generatedFiles,
      totalPages: generatedFiles.length,
      originalSize,
      newSize: totalNewSize,
    };

    if (usedFallback) {
      result.fallback = true;
      result.warning = 'Ghostscript nao encontrado. As paginas foram extraidas como arquivos PDF individuais em vez de imagens PNG. Instale o Ghostscript para conversao em imagens.';
    }

    return result;
  } catch (error) {
    // Limpa arquivos gerados em caso de erro
    generatedFiles.forEach((f) => safeUnlink(f.outputPath));
    throw new Error(`Erro ao converter PDF em imagens: ${error.message}`);
  }
}

/**
 * Executa o LibreOffice e retorna uma Promise.
 * Tenta 'soffice' e 'libreoffice' como candidatos.
 */
function runLibreOffice(args) {
  const candidates = process.platform === 'win32'
    ? ['soffice', 'libreoffice']
    : ['libreoffice', 'soffice'];

  return new Promise((resolve, reject) => {
    function tryNext(index) {
      if (index >= candidates.length) {
        reject(new Error('LIBREOFFICE_NOT_FOUND'));
        return;
      }

      execFile(candidates[index], args, { timeout: 120000 }, (error, stdout, stderr) => {
        if (error) {
          if (error.code === 'ENOENT' || (error.message && error.message.includes('ENOENT'))) {
            tryNext(index + 1);
            return;
          }
          reject(new Error(`Erro ao executar LibreOffice: ${stderr || error.message}`));
          return;
        }
        resolve({ stdout, stderr });
      });
    }

    tryNext(0);
  });
}

/**
 * Adiciona imagem de assinatura a um PDF.
 * Options: signatureData (base64 PNG), page = 'Primeira'|'Ultima'|'Todas' (padrao: 'Ultima'),
 *          x, y (posicao, padrao: canto inferior direito)
 */
async function sign(inputPath, options = {}) {
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.pdf`);

  try {
    const originalSize = fs.statSync(inputPath).size;

    if (!options.signatureData) {
      throw new Error('E necessario fornecer os dados da assinatura (signatureData).');
    }

    const inputBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(inputBytes, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();

    // Decodifica a imagem PNG da assinatura (remove prefixo data:image/png;base64, se presente)
    let sigData = options.signatureData;
    if (sigData.startsWith('data:')) {
      sigData = sigData.split(',')[1];
    }
    const signatureBytes = Buffer.from(sigData, 'base64');
    const signatureImage = await pdfDoc.embedPng(signatureBytes);

    const sigWidth = 150;
    const sigHeight = 60;

    const pageSetting = options.page || 'last';

    let targetIndices = [];
    if (pageSetting === 'first') {
      targetIndices = [0];
    } else if (pageSetting === 'all') {
      targetIndices = pages.map((_, i) => i);
    } else {
      // 'last' ou padrao
      targetIndices = [pages.length - 1];
    }

    for (const idx of targetIndices) {
      const page = pages[idx];
      const { width, height } = page.getSize();

      const x = options.x !== undefined ? options.x : width - sigWidth - 50;
      const y = options.y !== undefined ? options.y : 50;

      page.drawImage(signatureImage, {
        x,
        y,
        width: sigWidth,
        height: sigHeight,
      });
    }

    const signedBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, signedBytes);
    const newSize = fs.statSync(outputPath).size;

    return {
      outputPath,
      filename: `${outputId}.pdf`,
      originalSize,
      newSize,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao assinar PDF: ${error.message}`);
  }
}

/**
 * Adiciona marca d'agua de texto a todas as paginas do PDF.
 * Options: text (obrigatorio), fontSize (padrao: 36), opacity (0-100, padrao: 30),
 *          position = 'Centro'|'Topo'|'Rodape' (padrao: 'Centro'), color (hex, padrao: '#000000')
 */
async function watermark(inputPath, options = {}) {
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.pdf`);

  try {
    const originalSize = fs.statSync(inputPath).size;

    if (!options.text) {
      throw new Error('E necessario fornecer o texto da marca d\'agua.');
    }

    const inputBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(inputBytes, { ignoreEncryption: true });
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    const fontSize = options.fontSize || 36;
    const opacity = (options.opacity !== undefined ? options.opacity : 30) / 100;
    const position = options.position || 'center';

    // Parse hex color to RGB
    const hexColor = (options.color || '#000000').replace('#', '');
    const r = parseInt(hexColor.substring(0, 2), 16) / 255;
    const g = parseInt(hexColor.substring(2, 4), 16) / 255;
    const b = parseInt(hexColor.substring(4, 6), 16) / 255;

    for (const page of pages) {
      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(options.text, fontSize);

      let x, y;
      if (position === 'top') {
        x = (width - textWidth) / 2;
        y = height - 60;
      } else if (position === 'bottom') {
        x = (width - textWidth) / 2;
        y = 40;
      } else {
        // center - texto rotacionado na diagonal
        x = (width - textWidth) / 2;
        y = height / 2;
      }

      page.drawText(options.text, {
        x,
        y,
        size: fontSize,
        font,
        color: rgb(r, g, b),
        opacity,
        rotate: position === 'center' ? degrees(45) : degrees(0),
      });
    }

    const watermarkedBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, watermarkedBytes);
    const newSize = fs.statSync(outputPath).size;

    return {
      outputPath,
      filename: `${outputId}.pdf`,
      originalSize,
      newSize,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao adicionar marca d'agua: ${error.message}`);
  }
}

/**
 * Remove a senha de um PDF protegido.
 * Options: password (string - senha atual do PDF)
 */
async function unlock(inputPath, options = {}) {
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.pdf`);

  try {
    const originalSize = fs.statSync(inputPath).size;

    if (!options.password) {
      throw new Error('E necessario fornecer a senha atual do PDF.');
    }

    // Tenta Ghostscript primeiro
    try {
      await runGhostscript([
        '-sDEVICE=pdfwrite',
        '-dCompatibilityLevel=1.4',
        '-dNOPAUSE',
        '-dQUIET',
        '-dBATCH',
        `-sPDFPassword=${options.password}`,
        `-sOutputFile=${outputPath}`,
        inputPath,
      ]);

      const newSize = fs.statSync(outputPath).size;
      return {
        outputPath,
        filename: `${outputId}.pdf`,
        originalSize,
        newSize,
      };
    } catch (gsError) {
      if (gsError.message !== 'GS_NOT_FOUND') {
        throw gsError;
      }
    }

    // Fallback: pdf-lib com senha
    const inputBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(inputBytes, { password: options.password });

    const unlockedBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, unlockedBytes);
    const newSize = fs.statSync(outputPath).size;

    return {
      outputPath,
      filename: `${outputId}.pdf`,
      originalSize,
      newSize,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao desbloquear PDF: ${error.message}`);
  }
}

/**
 * Converte PDF para DOCX usando LibreOffice.
 * Fallback: extrai texto com pdf-parse e gera HTML com extensao .doc (Word abre HTML).
 */
async function toWord(inputPath, options = {}) {
  const outputId = uuidv4();

  try {
    const originalSize = fs.statSync(inputPath).size;

    // Copia o arquivo para tmp com nome unico para evitar conflitos
    const tmpInput = path.join(TMP_DIR, `${outputId}_input.pdf`);
    fs.copyFileSync(inputPath, tmpInput);

    try {
      await runLibreOffice([
        '--headless',
        '--convert-to', 'docx',
        '--outdir', TMP_DIR,
        tmpInput,
      ]);

      const generatedPath = path.join(TMP_DIR, `${outputId}_input.docx`);
      const finalPath = path.join(TMP_DIR, `${outputId}.docx`);

      if (fs.existsSync(generatedPath)) {
        fs.renameSync(generatedPath, finalPath);
      } else {
        throw new Error('Arquivo DOCX nao foi gerado. Verifique se o PDF e valido.');
      }

      safeUnlink(tmpInput);
      const newSize = fs.statSync(finalPath).size;

      return {
        outputPath: finalPath,
        filename: `${outputId}.docx`,
        originalSize,
        newSize,
      };
    } catch (loError) {
      if (loError.message !== 'LIBREOFFICE_NOT_FOUND') {
        throw loError;
      }
      // Fallback: extrair texto e gerar HTML com extensao .doc
    }

    safeUnlink(tmpInput);

    // Fallback: extrai texto do PDF e gera um arquivo HTML salvo como .doc
    const extractedText = await extractTextFromPdf(inputPath);

    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error(
        'LibreOffice nao encontrado e nao foi possivel extrair texto do PDF. ' +
        'Instale o LibreOffice para conversao completa de PDF para Word.'
      );
    }

    // Gera HTML que o Word consegue abrir
    const paragraphs = extractedText.split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => `<p>${escapeHtml(line)}</p>`)
      .join('\n');

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="Generator" content="virae-pdf-service">
<style>
  body { font-family: 'Calibri', 'Arial', sans-serif; font-size: 11pt; line-height: 1.5; margin: 2.5cm; }
  p { margin: 0 0 6pt 0; }
</style>
</head>
<body>
${paragraphs}
</body>
</html>`;

    const finalPath = path.join(TMP_DIR, `${outputId}.doc`);
    fs.writeFileSync(finalPath, htmlContent, 'utf8');
    const newSize = fs.statSync(finalPath).size;

    return {
      outputPath: finalPath,
      filename: `${outputId}.doc`,
      originalSize,
      newSize,
      warning: 'Conversao simplificada: o texto foi extraido do PDF e salvo como .doc (HTML). ' +
        'A formatacao original (imagens, tabelas, estilos) nao foi preservada. ' +
        'Instale o LibreOffice para conversao completa para DOCX.',
    };
  } catch (error) {
    safeUnlink(path.join(TMP_DIR, `${outputId}_input.pdf`));
    safeUnlink(path.join(TMP_DIR, `${outputId}_input.docx`));
    safeUnlink(path.join(TMP_DIR, `${outputId}.docx`));
    safeUnlink(path.join(TMP_DIR, `${outputId}.doc`));
    throw new Error(`Erro ao converter PDF para Word: ${error.message}`);
  }
}

/**
 * Converte PDF para XLSX usando LibreOffice.
 * Fallback: extrai texto com pdf-parse e gera CSV que o Excel consegue abrir.
 */
async function toExcel(inputPath, options = {}) {
  const outputId = uuidv4();

  try {
    const originalSize = fs.statSync(inputPath).size;

    const tmpInput = path.join(TMP_DIR, `${outputId}_input.pdf`);
    fs.copyFileSync(inputPath, tmpInput);

    try {
      await runLibreOffice([
        '--headless',
        '--convert-to', 'xlsx',
        '--outdir', TMP_DIR,
        tmpInput,
      ]);

      const generatedPath = path.join(TMP_DIR, `${outputId}_input.xlsx`);
      const finalPath = path.join(TMP_DIR, `${outputId}.xlsx`);

      if (fs.existsSync(generatedPath)) {
        fs.renameSync(generatedPath, finalPath);
      } else {
        throw new Error('Arquivo XLSX nao foi gerado. Verifique se o PDF e valido.');
      }

      safeUnlink(tmpInput);
      const newSize = fs.statSync(finalPath).size;

      return {
        outputPath: finalPath,
        filename: `${outputId}.xlsx`,
        originalSize,
        newSize,
      };
    } catch (loError) {
      if (loError.message !== 'LIBREOFFICE_NOT_FOUND') {
        throw loError;
      }
      // Fallback: extrair texto e gerar CSV
    }

    safeUnlink(tmpInput);

    // Fallback: extrai texto do PDF e gera CSV
    const extractedText = await extractTextFromPdf(inputPath);

    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error(
        'LibreOffice nao encontrado e nao foi possivel extrair texto do PDF. ' +
        'Instale o LibreOffice para conversao completa de PDF para Excel.'
      );
    }

    // Tenta identificar estruturas tabulares (linhas com separadores consistentes)
    // Separadores comuns: tab, pipe, ponto-e-virgula, multiplos espacos
    const lines = extractedText.split('\n').filter(l => l.trim().length > 0);
    const csvLines = [];

    // BOM UTF-8 para o Excel reconhecer acentos corretamente
    const BOM = '\uFEFF';

    for (const line of lines) {
      let cells;
      if (line.includes('\t')) {
        // Separado por tab
        cells = line.split('\t');
      } else if (line.includes('|')) {
        // Separado por pipe
        cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
      } else if (/\s{2,}/.test(line)) {
        // Multiplos espacos como separador
        cells = line.split(/\s{2,}/).map(c => c.trim());
      } else {
        // Linha simples - colocar em uma unica celula
        cells = [line.trim()];
      }

      // Escapar campos CSV (aspas duplas, virgulas)
      const csvRow = cells.map(cell => {
        const trimmed = cell.trim();
        if (trimmed.includes('"') || trimmed.includes(',') || trimmed.includes('\n')) {
          return '"' + trimmed.replace(/"/g, '""') + '"';
        }
        return trimmed;
      });
      csvLines.push(csvRow.join(','));
    }

    const finalPath = path.join(TMP_DIR, `${outputId}.csv`);
    fs.writeFileSync(finalPath, BOM + csvLines.join('\n'), 'utf8');
    const newSize = fs.statSync(finalPath).size;

    return {
      outputPath: finalPath,
      filename: `${outputId}.csv`,
      originalSize,
      newSize,
      warning: 'Conversao simplificada: o texto foi extraido do PDF e salvo como CSV. ' +
        'Estruturas tabulares foram detectadas automaticamente, mas a formatacao original ' +
        'nao foi preservada. Instale o LibreOffice para conversao completa para XLSX.',
    };
  } catch (error) {
    safeUnlink(path.join(TMP_DIR, `${outputId}_input.pdf`));
    safeUnlink(path.join(TMP_DIR, `${outputId}_input.xlsx`));
    safeUnlink(path.join(TMP_DIR, `${outputId}.xlsx`));
    safeUnlink(path.join(TMP_DIR, `${outputId}.csv`));
    throw new Error(`Erro ao converter PDF para Excel: ${error.message}`);
  }
}

/**
 * Converte PDF para PPTX usando LibreOffice.
 * Fallback: extrai texto com pdf-parse e gera HTML com extensao .ppt (PowerPoint abre HTML).
 */
async function toPpt(inputPath, options = {}) {
  const outputId = uuidv4();

  try {
    const originalSize = fs.statSync(inputPath).size;

    const tmpInput = path.join(TMP_DIR, `${outputId}_input.pdf`);
    fs.copyFileSync(inputPath, tmpInput);

    try {
      await runLibreOffice([
        '--headless',
        '--convert-to', 'pptx',
        '--outdir', TMP_DIR,
        tmpInput,
      ]);

      const generatedPath = path.join(TMP_DIR, `${outputId}_input.pptx`);
      const finalPath = path.join(TMP_DIR, `${outputId}.pptx`);

      if (fs.existsSync(generatedPath)) {
        fs.renameSync(generatedPath, finalPath);
      } else {
        throw new Error('Arquivo PPTX nao foi gerado. Verifique se o PDF e valido.');
      }

      safeUnlink(tmpInput);
      const newSize = fs.statSync(finalPath).size;

      return {
        outputPath: finalPath,
        filename: `${outputId}.pptx`,
        originalSize,
        newSize,
      };
    } catch (loError) {
      if (loError.message !== 'LIBREOFFICE_NOT_FOUND') {
        throw loError;
      }
      // Fallback: extrair texto e gerar HTML como apresentacao
    }

    safeUnlink(tmpInput);

    // Fallback: extrai texto do PDF e gera HTML estilizado como apresentacao
    const extractedText = await extractTextFromPdf(inputPath);

    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error(
        'LibreOffice nao encontrado e nao foi possivel extrair texto do PDF. ' +
        'Instale o LibreOffice para conversao completa de PDF para PowerPoint.'
      );
    }

    // Divide o texto em "slides" usando paragrafos vazios duplos ou blocos de texto
    const textBlocks = extractedText.split(/\n{2,}/).filter(b => b.trim().length > 0);

    // Agrupa blocos em slides (maximo ~5 blocos por slide)
    const slides = [];
    const BLOCKS_PER_SLIDE = 5;
    for (let i = 0; i < textBlocks.length; i += BLOCKS_PER_SLIDE) {
      const slideBlocks = textBlocks.slice(i, i + BLOCKS_PER_SLIDE);
      slides.push(slideBlocks);
    }

    // Se ficou sem slides, coloca tudo em um
    if (slides.length === 0) {
      slides.push([extractedText]);
    }

    const slideHtml = slides.map((slideBlocks, idx) => {
      const content = slideBlocks.map(block => {
        const lines = block.split('\n').filter(l => l.trim().length > 0);
        if (lines.length === 1 && lines[0].length < 80) {
          // Linha curta = titulo
          return `<h2>${escapeHtml(lines[0])}</h2>`;
        }
        return lines.map(l => `<p>${escapeHtml(l)}</p>`).join('\n');
      }).join('\n');

      return `<div class="slide">
  <div class="slide-number">Slide ${idx + 1}</div>
  ${content}
</div>`;
    }).join('\n');

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="Generator" content="virae-pdf-service">
<style>
  body { font-family: 'Calibri', 'Arial', sans-serif; margin: 0; padding: 0; background: #e0e0e0; }
  .slide {
    width: 960px; min-height: 540px; margin: 20px auto; padding: 40px 60px;
    background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    page-break-after: always; position: relative;
  }
  .slide-number { position: absolute; bottom: 15px; right: 25px; color: #999; font-size: 10pt; }
  h2 { font-size: 24pt; color: #333; margin: 0 0 20px 0; }
  p { font-size: 14pt; line-height: 1.6; margin: 0 0 8pt 0; color: #444; }
</style>
</head>
<body>
${slideHtml}
</body>
</html>`;

    const finalPath = path.join(TMP_DIR, `${outputId}.ppt`);
    fs.writeFileSync(finalPath, htmlContent, 'utf8');
    const newSize = fs.statSync(finalPath).size;

    return {
      outputPath: finalPath,
      filename: `${outputId}.ppt`,
      originalSize,
      newSize,
      warning: 'Conversao simplificada: o texto foi extraido do PDF e salvo como .ppt (HTML). ' +
        'A formatacao original (imagens, layouts, estilos) nao foi preservada. ' +
        'Instale o LibreOffice para conversao completa para PPTX.',
    };
  } catch (error) {
    safeUnlink(path.join(TMP_DIR, `${outputId}_input.pdf`));
    safeUnlink(path.join(TMP_DIR, `${outputId}_input.pptx`));
    safeUnlink(path.join(TMP_DIR, `${outputId}.pptx`));
    safeUnlink(path.join(TMP_DIR, `${outputId}.ppt`));
    throw new Error(`Erro ao converter PDF para PowerPoint: ${error.message}`);
  }
}

/**
 * Converte DOCX para PDF usando LibreOffice.
 * Fallback: extrai texto do DOCX (ZIP/XML) e gera PDF com pdf-lib.
 */
async function fromWord(inputPath, options = {}) {
  const outputId = uuidv4();

  try {
    const originalSize = fs.statSync(inputPath).size;

    const tmpInput = path.join(TMP_DIR, `${outputId}_input.docx`);
    fs.copyFileSync(inputPath, tmpInput);

    try {
      await runLibreOffice([
        '--headless',
        '--convert-to', 'pdf',
        '--outdir', TMP_DIR,
        tmpInput,
      ]);

      const generatedPath = path.join(TMP_DIR, `${outputId}_input.pdf`);
      const finalPath = path.join(TMP_DIR, `${outputId}.pdf`);

      if (fs.existsSync(generatedPath)) {
        fs.renameSync(generatedPath, finalPath);
      } else {
        throw new Error('Arquivo PDF nao foi gerado. Verifique se o DOCX e valido.');
      }

      safeUnlink(tmpInput);
      const newSize = fs.statSync(finalPath).size;

      return {
        outputPath: finalPath,
        filename: `${outputId}.pdf`,
        originalSize,
        newSize,
      };
    } catch (loError) {
      if (loError.message !== 'LIBREOFFICE_NOT_FOUND') {
        throw loError;
      }
      // Fallback: extrair texto do DOCX e gerar PDF com pdf-lib
    }

    safeUnlink(tmpInput);

    // Fallback: le o DOCX como ZIP, extrai texto do document.xml, gera PDF com pdf-lib
    const extractedText = extractTextFromDocx(inputPath);

    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error(
        'LibreOffice nao encontrado e nao foi possivel extrair texto do DOCX. ' +
        'Instale o LibreOffice para conversao completa de Word para PDF.'
      );
    }

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontSize = 11;
    const lineHeight = fontSize * 1.4;
    const margin = 50;

    const lines = extractedText.split('\n');
    let page = pdfDoc.addPage();
    let { width, height } = page.getSize();
    let y = height - margin;
    const maxWidth = width - 2 * margin;

    for (const rawLine of lines) {
      // Quebra de linha manual para linhas longas
      const words = rawLine.split(' ');
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        const testWidth = font.widthOfTextAtSize(testLine, fontSize);

        if (testWidth > maxWidth && currentLine) {
          // Desenha a linha atual
          if (y < margin + lineHeight) {
            page = pdfDoc.addPage();
            y = page.getSize().height - margin;
          }
          page.drawText(currentLine, { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
          y -= lineHeight;
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }

      // Desenha o restante da linha
      if (currentLine) {
        if (y < margin + lineHeight) {
          page = pdfDoc.addPage();
          y = page.getSize().height - margin;
        }
        page.drawText(currentLine, { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
        y -= lineHeight;
      } else {
        // Linha vazia - espaco entre paragrafos
        y -= lineHeight * 0.5;
      }
    }

    const finalPath = path.join(TMP_DIR, `${outputId}.pdf`);
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(finalPath, pdfBytes);
    const newSize = fs.statSync(finalPath).size;

    return {
      outputPath: finalPath,
      filename: `${outputId}.pdf`,
      originalSize,
      newSize,
      warning: 'Conversao simplificada: o texto foi extraido do DOCX e convertido para PDF. ' +
        'A formatacao original (imagens, tabelas, estilos, fontes) nao foi preservada. ' +
        'Instale o LibreOffice para conversao completa de Word para PDF.',
    };
  } catch (error) {
    safeUnlink(path.join(TMP_DIR, `${outputId}_input.docx`));
    safeUnlink(path.join(TMP_DIR, `${outputId}_input.pdf`));
    safeUnlink(path.join(TMP_DIR, `${outputId}.pdf`));
    throw new Error(`Erro ao converter Word para PDF: ${error.message}`);
  }
}

/**
 * Edicao basica de PDF (PRO). Placeholder: re-salva o PDF.
 */
/**
 * Edita um PDF adicionando texto em uma posicao especifica.
 * Options: text (obrigatorio), page (numero, padrao 1), x (padrao 50), y (padrao 100 do topo),
 *          fontSize (padrao 14), color (hex, padrao #000000), fontWeight (normal|bold)
 */
async function edit(inputPath, options = {}) {
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.pdf`);

  try {
    const originalSize = fs.statSync(inputPath).size;

    if (!options.text || !options.text.trim()) {
      throw new Error('Digite o texto que deseja adicionar ao PDF.');
    }

    const inputBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(inputBytes, { ignoreEncryption: true });

    const fontWeight = options.fontWeight || 'normal';
    const font = await pdfDoc.embedFont(
      fontWeight === 'bold' ? StandardFonts.HelveticaBold : StandardFonts.Helvetica
    );

    const pages = pdfDoc.getPages();
    const pageNum = Math.max(1, Math.min(parseInt(options.page, 10) || 1, pages.length));
    const page = pages[pageNum - 1];
    const { height } = page.getSize();

    const fontSize = parseInt(options.fontSize, 10) || 14;
    const x = parseFloat(options.x) || 50;
    const yFromTop = parseFloat(options.y) || 100;
    const y = height - yFromTop;

    // Parse hex color
    const hexColor = (options.color || '#000000').replace('#', '');
    const r = parseInt(hexColor.substring(0, 2), 16) / 255;
    const g = parseInt(hexColor.substring(2, 4), 16) / 255;
    const b = parseInt(hexColor.substring(4, 6), 16) / 255;

    // Suporte a texto multi-linha
    const lines = options.text.split('\\n');
    let currentY = y;
    for (const line of lines) {
      page.drawText(line, {
        x,
        y: currentY,
        size: fontSize,
        font,
        color: rgb(r, g, b),
      });
      currentY -= fontSize * 1.4;
    }

    const savedBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, savedBytes);
    const newSize = fs.statSync(outputPath).size;

    return {
      outputPath,
      filename: `${outputId}.pdf`,
      originalSize,
      newSize,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao editar PDF: ${error.message}`);
  }
}

module.exports = {
  compress,
  merge,
  split,
  rotate,
  protect,
  pageNumbers,
  toImage,
  sign,
  watermark,
  unlock,
  toWord,
  toExcel,
  toPpt,
  fromWord,
  edit,
};
