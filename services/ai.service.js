const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const TMP_DIR = path.join(__dirname, '..', 'tmp');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/**
 * Extrai texto de um arquivo baseado na extensao.
 */
const extractText = async (filePath) => {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.txt' || ext === '.md') {
    return fs.readFileSync(filePath, 'utf-8');
  }

  if (ext === '.csv') {
    return fs.readFileSync(filePath, 'utf-8');
  }

  if (ext === '.json') {
    return fs.readFileSync(filePath, 'utf-8');
  }

  if (ext === '.html' || ext === '.htm') {
    const html = fs.readFileSync(filePath, 'utf-8');
    // Remove tags HTML para extrair texto puro
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  if (ext === '.pdf') {
    // pdf-lib nao suporta extracao de texto diretamente.
    // Retorna null para indicar que precisamos de outra abordagem.
    return null;
  }

  if (ext === '.docx') {
    // Extracao basica de DOCX requer parsing do ZIP/XML.
    // Retorna null para indicar limitacao.
    return null;
  }

  return null;
};

/**
 * Faz chamada para a API de chat completions da OpenAI.
 */
const callOpenAI = async (messages, model = 'gpt-4o-mini') => {
  if (!OPENAI_API_KEY) {
    throw new Error(
      'Chave da API OpenAI nao configurada. Adicione OPENAI_API_KEY no arquivo .env'
    );
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: 4096 }),
  });

  if (!response.ok) {
    let errMsg = 'Erro na API OpenAI';
    try {
      const err = await response.json();
      errMsg = err.error?.message || errMsg;
    } catch {
      // Ignora erro ao parsear resposta
    }
    throw new Error(errMsg);
  }

  const data = await response.json();
  return data.choices[0].message.content;
};

/**
 * Faz chamada para a API de vision da OpenAI (imagens).
 */
const callOpenAIVision = async (prompt, imagePath, model = 'gpt-4o-mini') => {
  if (!OPENAI_API_KEY) {
    throw new Error(
      'Chave da API OpenAI nao configurada. Adicione OPENAI_API_KEY no arquivo .env'
    );
  }

  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const ext = path.extname(imagePath).toLowerCase();
  const mimeMap = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  };
  const mimeType = mimeMap[ext] || 'image/png';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    let errMsg = 'Erro na API OpenAI Vision';
    try {
      const err = await response.json();
      errMsg = err.error?.message || errMsg;
    } catch {
      // Ignora erro ao parsear resposta
    }
    throw new Error(errMsg);
  }

  const data = await response.json();
  return data.choices[0].message.content;
};

// ---------------------------------------------------------------------------
// AI Methods
// ---------------------------------------------------------------------------

/**
 * Resume o conteudo de um arquivo de texto usando GPT-4o-mini.
 */
const summarize = async (inputPath, options = {}) => {
  ensureTmpDir();

  const text = await extractText(inputPath);
  if (!text) {
    throw new Error(
      'Nao foi possivel extrair texto deste arquivo. Formatos suportados: TXT, MD, CSV, JSON, HTML.'
    );
  }

  const maxChars = 30000;
  const truncated = text.length > maxChars ? text.substring(0, maxChars) + '\n\n[Texto truncado...]' : text;

  const result = await callOpenAI([
    {
      role: 'system',
      content:
        'Voce e um assistente que resume textos de forma clara e concisa em portugues brasileiro.',
    },
    {
      role: 'user',
      content: `Resuma o seguinte texto em portugues:\n\n${truncated}`,
    },
  ]);

  const outputPath = path.join(TMP_DIR, `${uuidv4()}.txt`);
  fs.writeFileSync(outputPath, result, 'utf-8');

  return fileInfo(inputPath, outputPath);
};

/**
 * Traduz o conteudo de um arquivo de texto.
 */
const translate = async (inputPath, options = {}) => {
  ensureTmpDir();

  const { targetLang = 'en' } = options;

  const text = await extractText(inputPath);
  if (!text) {
    throw new Error(
      'Nao foi possivel extrair texto deste arquivo. Formatos suportados: TXT, MD, CSV, JSON, HTML.'
    );
  }

  const maxChars = 30000;
  const truncated = text.length > maxChars ? text.substring(0, maxChars) + '\n\n[Texto truncado...]' : text;

  const langNames = {
    en: 'ingles',
    es: 'espanhol',
    fr: 'frances',
    de: 'alemao',
    it: 'italiano',
    pt: 'portugues',
    ja: 'japones',
    ko: 'coreano',
    zh: 'chines',
    ru: 'russo',
    ar: 'arabe',
  };
  const langName = langNames[targetLang] || targetLang;

  const result = await callOpenAI([
    {
      role: 'system',
      content: `Voce e um tradutor profissional. Traduza o texto para ${langName}. Mantenha a formatacao original.`,
    },
    {
      role: 'user',
      content: `Traduza o seguinte texto para ${langName}:\n\n${truncated}`,
    },
  ]);

  const outputPath = path.join(TMP_DIR, `${uuidv4()}.txt`);
  fs.writeFileSync(outputPath, result, 'utf-8');

  return fileInfo(inputPath, outputPath);
};

/**
 * Reescreve o conteudo de um arquivo de texto.
 */
const rewrite = async (inputPath, options = {}) => {
  ensureTmpDir();

  const { style = 'formal' } = options;

  const text = await extractText(inputPath);
  if (!text) {
    throw new Error(
      'Nao foi possivel extrair texto deste arquivo. Formatos suportados: TXT, MD, CSV, JSON, HTML.'
    );
  }

  const maxChars = 30000;
  const truncated = text.length > maxChars ? text.substring(0, maxChars) + '\n\n[Texto truncado...]' : text;

  const stylePrompts = {
    formal: 'Reescreva o texto em um tom formal e profissional.',
    informal: 'Reescreva o texto em um tom informal e acessivel.',
    simples: 'Reescreva o texto de forma mais simples, facil de entender.',
    academico: 'Reescreva o texto em estilo academico.',
  };
  const styleInstruction = stylePrompts[style] || stylePrompts.formal;

  const result = await callOpenAI([
    {
      role: 'system',
      content: `Voce e um redator profissional em portugues brasileiro. ${styleInstruction} Mantenha o significado original.`,
    },
    {
      role: 'user',
      content: `Reescreva o seguinte texto:\n\n${truncated}`,
    },
  ]);

  const outputPath = path.join(TMP_DIR, `${uuidv4()}.txt`);
  fs.writeFileSync(outputPath, result, 'utf-8');

  return fileInfo(inputPath, outputPath);
};

/**
 * OCR para PDFs. Atualmente nao implementado.
 */
const ocr = async (inputPath, options = {}) => {
  throw new Error('OCR sera disponivel em breve.');
};

/**
 * OCR para imagens usando GPT-4o-mini vision.
 */
const ocrImage = async (inputPath, options = {}) => {
  ensureTmpDir();

  const result = await callOpenAIVision(
    'Extraia todo o texto visivel nesta imagem. Retorne apenas o texto extraido, sem comentarios adicionais. Mantenha a formatacao e estrutura original o maximo possivel.',
    inputPath
  );

  const outputPath = path.join(TMP_DIR, `${uuidv4()}.txt`);
  fs.writeFileSync(outputPath, result, 'utf-8');

  return fileInfo(inputPath, outputPath);
};

/**
 * Gera texto alternativo (alt text) para uma imagem.
 */
const altText = async (inputPath, options = {}) => {
  ensureTmpDir();

  const result = await callOpenAIVision(
    'Descreva esta imagem de forma detalhada em portugues brasileiro para uso como texto alternativo (alt text) de acessibilidade. A descricao deve ser clara, objetiva e util para pessoas com deficiencia visual.',
    inputPath
  );

  const outputPath = path.join(TMP_DIR, `${uuidv4()}.txt`);
  fs.writeFileSync(outputPath, result, 'utf-8');

  return fileInfo(inputPath, outputPath);
};

/**
 * Extrai dados estruturados de um arquivo usando GPT-4o-mini.
 */
const extractData = async (inputPath, options = {}) => {
  ensureTmpDir();

  const text = await extractText(inputPath);
  if (!text) {
    throw new Error(
      'Nao foi possivel extrair texto deste arquivo. Formatos suportados: TXT, MD, CSV, JSON, HTML.'
    );
  }

  const maxChars = 30000;
  const truncated = text.length > maxChars ? text.substring(0, maxChars) + '\n\n[Texto truncado...]' : text;

  const result = await callOpenAI([
    {
      role: 'system',
      content:
        'Voce e um assistente especializado em extracao de dados. Extraia informacoes estruturadas do texto e retorne em formato JSON valido. Identifique entidades como nomes, datas, valores, enderecos, emails, telefones e outros dados relevantes.',
    },
    {
      role: 'user',
      content: `Extraia dados estruturados do seguinte texto e retorne em JSON:\n\n${truncated}`,
    },
  ]);

  // Tenta parsear o JSON para garantir validade
  let jsonContent = result;
  try {
    // Remove blocos de codigo markdown se presentes
    const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonContent = jsonMatch[1].trim();
    }
    JSON.parse(jsonContent);
  } catch {
    // Se nao for JSON valido, encapsula o resultado
    jsonContent = JSON.stringify({ resultado: result }, null, 2);
  }

  const outputPath = path.join(TMP_DIR, `${uuidv4()}.json`);
  fs.writeFileSync(outputPath, jsonContent, 'utf-8');

  return fileInfo(inputPath, outputPath);
};

/**
 * Transcreve audio usando a API Whisper da OpenAI.
 */
const transcribe = async (inputPath, options = {}) => {
  ensureTmpDir();

  if (!OPENAI_API_KEY) {
    throw new Error(
      'Chave da API OpenAI nao configurada. Adicione OPENAI_API_KEY no arquivo .env'
    );
  }

  const { language = 'pt' } = options;
  const fileBuffer = fs.readFileSync(inputPath);
  const fileName = path.basename(inputPath);

  // Monta multipart/form-data manualmente
  const boundary = `----FormBoundary${uuidv4().replace(/-/g, '')}`;
  const ext = path.extname(inputPath).toLowerCase();
  const mimeMap = {
    '.mp3': 'audio/mpeg',
    '.mp4': 'audio/mp4',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.webm': 'audio/webm',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.mpeg': 'audio/mpeg',
  };
  const mimeType = mimeMap[ext] || 'audio/mpeg';

  const parts = [];
  // Campo model
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`
  );
  // Campo language
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${language}\r\n`
  );
  // Campo file
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`
  );

  const header = Buffer.from(parts.join(''));
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, fileBuffer, footer]);

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    let errMsg = 'Erro na transcricao de audio';
    try {
      const err = await response.json();
      errMsg = err.error?.message || errMsg;
    } catch {
      // Ignora erro ao parsear resposta
    }
    throw new Error(errMsg);
  }

  const data = await response.json();
  const text = data.text || '';

  const outputPath = path.join(TMP_DIR, `${uuidv4()}.txt`);
  fs.writeFileSync(outputPath, text, 'utf-8');

  return fileInfo(inputPath, outputPath);
};

/**
 * Transcreve video/audio. Para video, tenta extrair audio com ffmpeg primeiro.
 */
const transcribeMedia = async (inputPath, options = {}) => {
  ensureTmpDir();

  const ext = path.extname(inputPath).toLowerCase();
  const videoExts = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm'];

  if (videoExts.includes(ext)) {
    // Tenta extrair audio do video usando ffmpeg
    const { execFile: execFileCb } = require('child_process');
    const hasFFmpeg = await new Promise((resolve) => {
      execFileCb('ffmpeg', ['-version'], (err) => resolve(!err));
    });

    if (!hasFFmpeg) {
      throw new Error(
        'ffmpeg nao encontrado. Instale o ffmpeg para transcrever videos.'
      );
    }

    const audioPath = path.join(TMP_DIR, `${uuidv4()}.mp3`);

    await new Promise((resolve, reject) => {
      execFileCb(
        'ffmpeg',
        ['-i', inputPath, '-vn', '-acodec', 'libmp3lame', '-q:a', '4', '-y', audioPath],
        { timeout: 120000 },
        (err, stdout, stderr) => {
          if (err) reject(new Error(`Erro ao extrair audio: ${stderr || err.message}`));
          else resolve(stdout);
        }
      );
    });

    try {
      const result = await transcribe(audioPath, options);
      // Limpa audio temporario
      fs.unlink(audioPath, () => {});
      return result;
    } catch (err) {
      fs.unlink(audioPath, () => {});
      throw err;
    }
  }

  // Para arquivos de audio, usa transcribe diretamente
  return transcribe(inputPath, options);
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  summarize,
  translate,
  rewrite,
  ocr,
  ocrImage,
  altText,
  extractData,
  transcribe,
  transcribeMedia,
  // Helpers expostos para testes
  extractText,
  callOpenAI,
  callOpenAIVision,
};
