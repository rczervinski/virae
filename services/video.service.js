const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const TMP_DIR = path.join(__dirname, '..', 'tmp');

// Garante que o diretorio tmp existe
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
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
 * Executa o ffmpeg e retorna uma Promise.
 */
function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { timeout: 600000 }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ENOENT') {
          reject(new Error(
            'FFmpeg nao encontrado. E necessario instalar o FFmpeg para processar arquivos de video.'
          ));
          return;
        }
        reject(new Error(`Erro no FFmpeg: ${stderr || error.message}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Executa o ffprobe para obter informacoes do arquivo.
 */
function runFFprobe(inputPath) {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      inputPath,
    ], { timeout: 30000 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        resolve(null);
      }
    });
  });
}

/**
 * Obtem a duracao de um arquivo de video.
 */
async function getDuration(filePath) {
  const info = await runFFprobe(filePath);
  if (info && info.format && info.format.duration) {
    return parseFloat(info.format.duration);
  }
  return null;
}

/**
 * Mapeamento de resolucao.
 */
const RESOLUTION_MAP = {
  '4k': '3840:2160',
  '1080p': '1920:1080',
  '720p': '1280:720',
  '480p': '854:480',
};

/**
 * Converte formato de video.
 * Options: format ('mp4'|'webm'|'mov'|'avi'|'mkv')
 */
async function convert(inputPath, options = {}) {
  const format = (options.format || 'mp4').toLowerCase();
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.${format}`);

  try {
    const originalSize = fs.statSync(inputPath).size;

    const args = ['-i', inputPath, '-y'];

    switch (format) {
      case 'mp4':
        args.push('-codec:v', 'libx264', '-codec:a', 'aac', '-movflags', '+faststart');
        break;
      case 'webm':
        args.push('-codec:v', 'libvpx-vp9', '-codec:a', 'libopus', '-b:v', '1M');
        break;
      case 'mov':
        args.push('-codec:v', 'libx264', '-codec:a', 'aac');
        break;
      case 'avi':
        args.push('-codec:v', 'mpeg4', '-codec:a', 'mp3');
        break;
      case 'mkv':
        args.push('-codec:v', 'libx264', '-codec:a', 'aac');
        break;
      default:
        throw new Error(`Formato de video nao suportado: ${format}`);
    }

    args.push(outputPath);
    await runFFmpeg(args);

    const newSize = fs.statSync(outputPath).size;
    const duration = await getDuration(outputPath);

    return {
      outputPath,
      filename: `${outputId}.${format}`,
      originalSize,
      newSize,
      duration,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao converter video: ${error.message}`);
  }
}

/**
 * Comprime video reduzindo a qualidade.
 * Options: quality ('low'|'medium'|'high', padrao: 'medium')
 */
async function compress(inputPath, options = {}) {
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.mp4`);

  try {
    const originalSize = fs.statSync(inputPath).size;

    // CRF: menor = melhor qualidade, maior = mais compressao
    const crfMap = {
      high: '18',    // Alta qualidade, menor compressao
      medium: '28',  // Qualidade media, compressao moderada
      low: '35',     // Baixa qualidade, maior compressao
    };

    const quality = options.quality || 'medium';
    const crf = crfMap[quality] || '28';

    const args = [
      '-i', inputPath,
      '-codec:v', 'libx264',
      '-crf', crf,
      '-preset', 'medium',
      '-codec:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ];

    await runFFmpeg(args);

    const newSize = fs.statSync(outputPath).size;
    const duration = await getDuration(outputPath);

    return {
      outputPath,
      filename: `${outputId}.mp4`,
      originalSize,
      newSize,
      duration,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao comprimir video: ${error.message}`);
  }
}

/**
 * Corta um trecho de video.
 * Options: start (segundos), end (segundos)
 */
async function trim(inputPath, options = {}) {
  const outputId = uuidv4();
  const inputExt = path.extname(inputPath).slice(1) || 'mp4';
  const outputPath = path.join(TMP_DIR, `${outputId}.${inputExt}`);

  try {
    const originalSize = fs.statSync(inputPath).size;
    const start = parseFloat(options.start) || 0;

    if (options.end !== undefined && parseFloat(options.end) <= start) {
      throw new Error('O tempo final deve ser maior que o tempo inicial.');
    }

    const args = ['-i', inputPath, '-ss', String(start)];

    if (options.end !== undefined) {
      const duration = parseFloat(options.end) - start;
      args.push('-t', String(duration));
    }

    args.push('-codec', 'copy', '-y', outputPath);
    await runFFmpeg(args);

    const newSize = fs.statSync(outputPath).size;
    const duration = await getDuration(outputPath);

    return {
      outputPath,
      filename: `${outputId}.${inputExt}`,
      originalSize,
      newSize,
      duration,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao cortar video: ${error.message}`);
  }
}

/**
 * Extrai a faixa de audio de um video.
 * Options: format ('mp3'|'wav', padrao: 'mp3')
 */
async function extractAudio(inputPath, options = {}) {
  const format = (options.format || 'mp3').toLowerCase();
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.${format}`);

  try {
    const originalSize = fs.statSync(inputPath).size;

    const args = ['-i', inputPath, '-vn'];

    switch (format) {
      case 'mp3':
        args.push('-codec:a', 'libmp3lame', '-q:a', '2');
        break;
      case 'wav':
        args.push('-codec:a', 'pcm_s16le');
        break;
      default:
        throw new Error(`Formato de audio nao suportado: ${format}. Use mp3 ou wav.`);
    }

    args.push('-y', outputPath);
    await runFFmpeg(args);

    const newSize = fs.statSync(outputPath).size;
    const duration = await getDuration(outputPath);

    return {
      outputPath,
      filename: `${outputId}.${format}`,
      originalSize,
      newSize,
      duration,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao extrair audio: ${error.message}`);
  }
}

/**
 * Remove a faixa de audio do video.
 */
async function removeAudio(inputPath, options = {}) {
  const outputId = uuidv4();
  const inputExt = path.extname(inputPath).slice(1) || 'mp4';
  const outputPath = path.join(TMP_DIR, `${outputId}.${inputExt}`);

  try {
    const originalSize = fs.statSync(inputPath).size;

    const args = [
      '-i', inputPath,
      '-an',
      '-codec:v', 'copy',
      '-y',
      outputPath,
    ];

    await runFFmpeg(args);

    const newSize = fs.statSync(outputPath).size;
    const duration = await getDuration(outputPath);

    return {
      outputPath,
      filename: `${outputId}.${inputExt}`,
      originalSize,
      newSize,
      duration,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao remover audio do video: ${error.message}`);
  }
}

/**
 * Altera a resolucao do video.
 * Options: resolution ('4k'|'1080p'|'720p'|'480p')
 */
async function resize(inputPath, options = {}) {
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.mp4`);

  try {
    const originalSize = fs.statSync(inputPath).size;
    const resolution = options.resolution || '720p';
    const scale = RESOLUTION_MAP[resolution];

    if (!scale) {
      throw new Error(
        `Resolucao nao suportada: ${resolution}. Use: ${Object.keys(RESOLUTION_MAP).join(', ')}`
      );
    }

    // Usa scale com -2 para manter proporcao (arredonda para par)
    const [w] = scale.split(':');
    const args = [
      '-i', inputPath,
      '-vf', `scale=${w}:-2`,
      '-codec:v', 'libx264',
      '-crf', '23',
      '-preset', 'medium',
      '-codec:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ];

    await runFFmpeg(args);

    const newSize = fs.statSync(outputPath).size;
    const duration = await getDuration(outputPath);

    return {
      outputPath,
      filename: `${outputId}.mp4`,
      originalSize,
      newSize,
      duration,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao redimensionar video: ${error.message}`);
  }
}

/**
 * Altera a velocidade do video.
 * Options: rate (0.25 a 4.0, padrao: 1.0)
 */
async function speed(inputPath, options = {}) {
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.mp4`);

  try {
    const originalSize = fs.statSync(inputPath).size;
    const rate = parseFloat(options.rate) || 1.0;

    if (rate < 0.25 || rate > 4.0) {
      throw new Error('Taxa de velocidade invalida. Use um valor entre 0.25 e 4.0.');
    }

    // setpts: PTS/rate para video (menor = mais rapido)
    // atempo: so aceita 0.5-2.0, encadeia para valores extremos
    const videoPts = (1 / rate).toFixed(4);

    let audioFilter;
    if (rate >= 0.5 && rate <= 2.0) {
      audioFilter = `atempo=${rate}`;
    } else if (rate < 0.5) {
      // Encadeia: ex. 0.25 = atempo=0.5,atempo=0.5
      audioFilter = `atempo=0.5,atempo=${(rate / 0.5).toFixed(4)}`;
    } else {
      // rate > 2.0: ex. 4.0 = atempo=2.0,atempo=2.0
      audioFilter = `atempo=2.0,atempo=${(rate / 2.0).toFixed(4)}`;
    }

    const args = [
      '-i', inputPath,
      '-filter_complex', `[0:v]setpts=${videoPts}*PTS[v];[0:a]${audioFilter}[a]`,
      '-map', '[v]',
      '-map', '[a]',
      '-codec:v', 'libx264',
      '-crf', '23',
      '-preset', 'medium',
      '-codec:a', 'aac',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ];

    await runFFmpeg(args);

    const newSize = fs.statSync(outputPath).size;
    const duration = await getDuration(outputPath);

    return {
      outputPath,
      filename: `${outputId}.mp4`,
      originalSize,
      newSize,
      duration,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao alterar velocidade do video: ${error.message}`);
  }
}

/**
 * Extrai um frame do video como imagem.
 * Options: time (segundos, padrao: 0)
 */
async function screenshot(inputPath, options = {}) {
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.png`);

  try {
    const originalSize = fs.statSync(inputPath).size;
    const time = parseFloat(options.time) || 0;

    const args = [
      '-i', inputPath,
      '-ss', String(time),
      '-vframes', '1',
      '-y',
      outputPath,
    ];

    await runFFmpeg(args);

    if (!fs.existsSync(outputPath)) {
      throw new Error('Nao foi possivel extrair o frame. Verifique o tempo informado.');
    }

    const newSize = fs.statSync(outputPath).size;

    return {
      outputPath,
      filename: `${outputId}.png`,
      originalSize,
      newSize,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao extrair frame do video: ${error.message}`);
  }
}

module.exports = {
  convert,
  compress,
  trim,
  extractAudio,
  removeAudio,
  resize,
  speed,
  screenshot,
};
