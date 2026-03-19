const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const TMP_DIR = path.join(__dirname, '..', 'tmp');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const runCommand = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });

const checkCommand = (cmd) =>
  new Promise((resolve) => {
    const bin = cmd.includes(' ') ? cmd.split(' ')[0] : cmd;
    execFile(bin, ['--version'], (err) => resolve(!err));
  });

const ensureTmpDir = () => {
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }
};

const fileInfo = (inputPath, outputPath) => ({
  outputPath,
  filename: path.basename(outputPath),
  originalSize: fs.existsSync(inputPath) ? fs.statSync(inputPath).size : 0,
  newSize: fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0,
});

// ---------------------------------------------------------------------------
// LibreOffice conversion (generic)
// ---------------------------------------------------------------------------

const libreOfficeConvert = async (inputPath, targetFormat) => {
  ensureTmpDir();

  const hasLO = await checkCommand('libreoffice');
  if (!hasLO) {
    throw new Error('LibreOffice nao encontrado. Instale o LibreOffice para usar esta conversao.');
  }

  const uid = uuidv4();
  const workDir = path.join(TMP_DIR, uid);
  fs.mkdirSync(workDir, { recursive: true });

  await runCommand('libreoffice', [
    '--headless',
    '--convert-to',
    targetFormat,
    '--outdir',
    workDir,
    inputPath,
  ]);

  // LibreOffice keeps the original basename, just changes the extension
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(workDir, `${baseName}.${targetFormat}`);

  if (!fs.existsSync(outputPath)) {
    // Try to find any file in workDir
    const files = fs.readdirSync(workDir);
    if (files.length > 0) {
      const found = path.join(workDir, files[0]);
      return fileInfo(inputPath, found);
    }
    throw new Error('Falha na conversao: arquivo de saida nao encontrado.');
  }

  return fileInfo(inputPath, outputPath);
};

// ---------------------------------------------------------------------------
// Conversion methods
// ---------------------------------------------------------------------------

/**
 * Converte DOCX para PDF usando LibreOffice headless.
 */
const docxToPdf = async (inputPath, options = {}) => {
  return libreOfficeConvert(inputPath, 'pdf');
};

/**
 * Converte XLSX para PDF usando LibreOffice headless.
 */
const xlsxToPdf = async (inputPath, options = {}) => {
  return libreOfficeConvert(inputPath, 'pdf');
};

/**
 * Converte PPT/PPTX para PDF usando LibreOffice headless.
 */
const pptToPdf = async (inputPath, options = {}) => {
  return libreOfficeConvert(inputPath, 'pdf');
};

/**
 * Converte CSV para XLSX usando LibreOffice headless.
 */
const csvToXlsx = async (inputPath, options = {}) => {
  const hasLO = await checkCommand('libreoffice');
  if (!hasLO) {
    throw new Error(
      'LibreOffice nao encontrado. Conversao CSV para XLSX requer LibreOffice.'
    );
  }
  return libreOfficeConvert(inputPath, 'xlsx');
};

/**
 * Converte TXT para PDF usando pdf-lib.
 */
const txtToPdf = async (inputPath, options = {}) => {
  ensureTmpDir();

  const text = fs.readFileSync(inputPath, 'utf-8');
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = options.fontSize || 12;
  const margin = 50;
  const pageWidth = 595.28; // A4
  const pageHeight = 841.89;
  const maxLineWidth = pageWidth - margin * 2;
  const lineHeight = fontSize * 1.4;

  const lines = [];
  const rawLines = text.split('\n');

  // Word-wrap each line
  for (const rawLine of rawLines) {
    if (rawLine.trim() === '') {
      lines.push('');
      continue;
    }
    const words = rawLine.split(/\s+/);
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      const width = font.widthOfTextAtSize(test, fontSize);
      if (width > maxLineWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
  }

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  for (const line of lines) {
    if (y < margin) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    if (line !== '') {
      page.drawText(line, {
        x: margin,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    }
    y -= lineHeight;
  }

  const pdfBytes = await pdfDoc.save();
  const outputPath = path.join(TMP_DIR, `${uuidv4()}.pdf`);
  fs.writeFileSync(outputPath, pdfBytes);

  return fileInfo(inputPath, outputPath);
};

/**
 * Converte HTML para PDF usando LibreOffice headless.
 */
const htmlToPdf = async (inputPath, options = {}) => {
  const hasLO = await checkCommand('libreoffice');
  if (!hasLO) {
    throw new Error(
      'LibreOffice nao encontrado. Conversao HTML para PDF requer LibreOffice.'
    );
  }
  return libreOfficeConvert(inputPath, 'pdf');
};

/**
 * Converte EPUB para PDF usando LibreOffice headless.
 */
const epubToPdf = async (inputPath, options = {}) => {
  return libreOfficeConvert(inputPath, 'pdf');
};

/**
 * Converte Markdown para PDF.
 * Converte MD -> HTML simples e depois usa mesma abordagem de htmlToPdf.
 */
const mdToPdf = async (inputPath, options = {}) => {
  ensureTmpDir();

  const md = fs.readFileSync(inputPath, 'utf-8');

  // Conversao simples de Markdown para HTML
  let html = md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^\- (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '<br><br>');

  html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body { font-family: sans-serif; margin: 40px; line-height: 1.6; }
h1, h2, h3 { color: #333; }
code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
</style></head><body>${html}</body></html>`;

  const tmpHtml = path.join(TMP_DIR, `${uuidv4()}.html`);
  fs.writeFileSync(tmpHtml, html, 'utf-8');

  try {
    const result = await htmlToPdf(tmpHtml, options);
    // Limpa o HTML temporario
    fs.unlink(tmpHtml, () => {});
    return result;
  } catch (err) {
    fs.unlink(tmpHtml, () => {});
    throw err;
  }
};

/**
 * Converte entre JSON e CSV.
 * Detecta automaticamente o formato de entrada.
 */
const jsonCsv = async (inputPath, options = {}) => {
  ensureTmpDir();

  const ext = path.extname(inputPath).toLowerCase();
  const content = fs.readFileSync(inputPath, 'utf-8');

  if (ext === '.json') {
    // JSON -> CSV
    let data;
    try {
      data = JSON.parse(content);
    } catch {
      throw new Error('Arquivo JSON invalido.');
    }

    if (!Array.isArray(data)) {
      throw new Error('JSON deve ser um array de objetos para conversao em CSV.');
    }

    if (data.length === 0) {
      throw new Error('Array JSON esta vazio.');
    }

    const headers = [...new Set(data.flatMap((obj) => Object.keys(obj)))];
    const csvLines = [headers.join(',')];

    for (const row of data) {
      const values = headers.map((h) => {
        const val = row[h] !== undefined ? String(row[h]) : '';
        // Escapa valores com virgula, aspas ou quebra de linha
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      });
      csvLines.push(values.join(','));
    }

    const outputPath = path.join(TMP_DIR, `${uuidv4()}.csv`);
    fs.writeFileSync(outputPath, csvLines.join('\n'), 'utf-8');
    return fileInfo(inputPath, outputPath);
  }

  if (ext === '.csv') {
    // CSV -> JSON
    const lines = content.split('\n').filter((l) => l.trim() !== '');
    if (lines.length < 2) {
      throw new Error('CSV deve ter pelo menos um cabecalho e uma linha de dados.');
    }

    const parseCSVLine = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"' && line[i + 1] === '"') {
            current += '"';
            i++;
          } else if (ch === '"') {
            inQuotes = false;
          } else {
            current += ch;
          }
        } else {
          if (ch === '"') {
            inQuotes = true;
          } else if (ch === ',') {
            result.push(current.trim());
            current = '';
          } else {
            current += ch;
          }
        }
      }
      result.push(current.trim());
      return result;
    };

    const headers = parseCSVLine(lines[0]);
    const jsonData = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      const obj = {};
      headers.forEach((header, idx) => {
        obj[header] = values[idx] || '';
      });
      jsonData.push(obj);
    }

    const outputPath = path.join(TMP_DIR, `${uuidv4()}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(jsonData, null, 2), 'utf-8');
    return fileInfo(inputPath, outputPath);
  }

  throw new Error('Formato nao suportado. Use arquivos .json ou .csv.');
};

/**
 * Extrai ou cria arquivos compactados.
 * options.action: 'extract' | 'create'
 */
const archive = async (inputPath, options = {}) => {
  ensureTmpDir();

  const { action = 'extract' } = options;
  const ext = path.extname(inputPath).toLowerCase();
  const uid = uuidv4();

  if (action === 'extract') {
    const outputDir = path.join(TMP_DIR, uid);
    fs.mkdirSync(outputDir, { recursive: true });

    if (ext === '.zip') {
      const hasUnzip = await checkCommand('unzip');
      if (!hasUnzip) {
        throw new Error('Comando unzip nao encontrado. Instale o unzip para extrair arquivos ZIP.');
      }
      await runCommand('unzip', ['-o', inputPath, '-d', outputDir]);
    } else if (ext === '.tar' || ext === '.gz' || ext === '.tgz') {
      const hasTar = await checkCommand('tar');
      if (!hasTar) {
        throw new Error('Comando tar nao encontrado.');
      }
      await runCommand('tar', ['-xf', inputPath, '-C', outputDir]);
    } else {
      throw new Error(`Formato de arquivo nao suportado para extracao: ${ext}`);
    }

    return {
      outputPath: outputDir,
      filename: uid,
      originalSize: fs.statSync(inputPath).size,
      newSize: 0, // Diretorio
    };
  }

  if (action === 'create') {
    const hasZip = await checkCommand('zip');
    if (!hasZip) {
      throw new Error('Comando zip nao encontrado. Instale o zip para criar arquivos compactados.');
    }

    const outputPath = path.join(TMP_DIR, `${uid}.zip`);
    const stat = fs.statSync(inputPath);

    if (stat.isDirectory()) {
      await runCommand('zip', ['-r', '-j', outputPath, inputPath]);
    } else {
      await runCommand('zip', ['-j', outputPath, inputPath]);
    }

    return fileInfo(inputPath, outputPath);
  }

  throw new Error('Acao invalida. Use "extract" ou "create".');
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  docxToPdf,
  xlsxToPdf,
  pptToPdf,
  csvToXlsx,
  txtToPdf,
  htmlToPdf,
  epubToPdf,
  mdToPdf,
  jsonCsv,
  archive,
  // Helpers expostos para testes
  runCommand,
  checkCommand,
};
