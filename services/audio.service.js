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
    execFile('ffmpeg', args, { timeout: 300000 }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ENOENT') {
          reject(new Error(
            'FFmpeg nao encontrado. E necessario instalar o FFmpeg para processar arquivos de audio.'
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
    ], { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ENOENT') {
          // ffprobe nao disponivel, retorna info basica
          resolve(null);
          return;
        }
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
 * Obtem a duracao de um arquivo de audio.
 */
async function getDuration(filePath) {
  const info = await runFFprobe(filePath);
  if (info && info.format && info.format.duration) {
    return parseFloat(info.format.duration);
  }
  return null;
}

/**
 * Mapeamento de formato para extensao.
 */
function getExtension(format) {
  const map = {
    mp3: 'mp3',
    wav: 'wav',
    flac: 'flac',
    ogg: 'ogg',
    aac: 'aac',
    m4a: 'm4a',
  };
  return map[format] || format;
}

/**
 * Converte formato de audio.
 * Options: format ('mp3'|'wav'|'flac'|'ogg'|'aac'|'m4a')
 */
async function convert(inputPath, options = {}) {
  const format = (options.format || 'mp3').toLowerCase();
  const ext = getExtension(format);
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.${ext}`);

  try {
    const originalSize = fs.statSync(inputPath).size;

    const args = ['-i', inputPath, '-y'];

    switch (format) {
      case 'mp3':
        args.push('-codec:a', 'libmp3lame', '-q:a', '2');
        break;
      case 'wav':
        args.push('-codec:a', 'pcm_s16le');
        break;
      case 'flac':
        args.push('-codec:a', 'flac');
        break;
      case 'ogg':
        args.push('-codec:a', 'libvorbis', '-q:a', '5');
        break;
      case 'aac':
        args.push('-codec:a', 'aac', '-b:a', '192k');
        break;
      case 'm4a':
        args.push('-codec:a', 'aac', '-b:a', '192k');
        break;
      default:
        throw new Error(`Formato de audio nao suportado: ${format}`);
    }

    args.push(outputPath);
    await runFFmpeg(args);

    const newSize = fs.statSync(outputPath).size;
    const duration = await getDuration(outputPath);

    return {
      outputPath,
      filename: `${outputId}.${ext}`,
      originalSize,
      newSize,
      duration,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao converter audio: ${error.message}`);
  }
}

/**
 * Corta um trecho de audio.
 * Options: start (segundos), end (segundos)
 */
async function trim(inputPath, options = {}) {
  const outputId = uuidv4();
  const inputExt = path.extname(inputPath).slice(1) || 'mp3';
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

    args.push('-y', '-codec', 'copy', outputPath);
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
    throw new Error(`Erro ao cortar audio: ${error.message}`);
  }
}

/**
 * Concatena multiplos arquivos de audio.
 * Options: format (padrao: 'mp3')
 */
async function merge(inputPaths, options = {}) {
  const format = (options.format || 'mp3').toLowerCase();
  const ext = getExtension(format);
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.${ext}`);
  const listPath = path.join(TMP_DIR, `${outputId}_list.txt`);

  try {
    if (!inputPaths || inputPaths.length < 2) {
      throw new Error('E necessario pelo menos 2 arquivos de audio para concatenar.');
    }

    let totalOriginalSize = 0;
    // Cria arquivo de lista para concat do ffmpeg
    const listContent = inputPaths.map((p) => {
      totalOriginalSize += fs.statSync(p).size;
      return `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
    }).join('\n');

    fs.writeFileSync(listPath, listContent);

    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-y',
    ];

    switch (format) {
      case 'mp3':
        args.push('-codec:a', 'libmp3lame', '-q:a', '2');
        break;
      case 'wav':
        args.push('-codec:a', 'pcm_s16le');
        break;
      default:
        args.push('-codec:a', 'copy');
    }

    args.push(outputPath);
    await runFFmpeg(args);

    safeUnlink(listPath);

    const newSize = fs.statSync(outputPath).size;
    const duration = await getDuration(outputPath);

    return {
      outputPath,
      filename: `${outputId}.${ext}`,
      originalSize: totalOriginalSize,
      newSize,
      duration,
    };
  } catch (error) {
    safeUnlink(outputPath);
    safeUnlink(listPath);
    throw new Error(`Erro ao concatenar audios: ${error.message}`);
  }
}

/**
 * Comprime audio reduzindo o bitrate.
 * Options: bitrate ('64k'|'128k'|'192k'|'256k'|'320k', padrao: '128k')
 */
async function compress(inputPath, options = {}) {
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.mp3`);

  try {
    const originalSize = fs.statSync(inputPath).size;
    const bitrate = options.bitrate || '128k';

    const validBitrates = ['64k', '128k', '192k', '256k', '320k'];
    if (!validBitrates.includes(bitrate)) {
      throw new Error(`Bitrate invalido: ${bitrate}. Use: ${validBitrates.join(', ')}`);
    }

    const args = [
      '-i', inputPath,
      '-codec:a', 'libmp3lame',
      '-b:a', bitrate,
      '-y',
      outputPath,
    ];

    await runFFmpeg(args);

    const newSize = fs.statSync(outputPath).size;
    const duration = await getDuration(outputPath);

    return {
      outputPath,
      filename: `${outputId}.mp3`,
      originalSize,
      newSize,
      duration,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao comprimir audio: ${error.message}`);
  }
}

/**
 * Ajusta o volume do audio.
 * Options: level (0.5 = metade, 2.0 = dobro, padrao: 1.0)
 */
async function volume(inputPath, options = {}) {
  const outputId = uuidv4();
  const inputExt = path.extname(inputPath).slice(1) || 'mp3';
  const outputPath = path.join(TMP_DIR, `${outputId}.${inputExt}`);

  try {
    const originalSize = fs.statSync(inputPath).size;
    const level = parseFloat(options.level) || 1.0;

    if (level <= 0 || level > 10) {
      throw new Error('Nivel de volume invalido. Use um valor entre 0.1 e 10.0.');
    }

    const args = [
      '-i', inputPath,
      '-af', `volume=${level}`,
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
    throw new Error(`Erro ao ajustar volume: ${error.message}`);
  }
}

/**
 * Altera a velocidade do audio.
 * Options: rate (0.5 a 2.0, padrao: 1.0)
 */
async function speed(inputPath, options = {}) {
  const outputId = uuidv4();
  const inputExt = path.extname(inputPath).slice(1) || 'mp3';
  const outputPath = path.join(TMP_DIR, `${outputId}.${inputExt}`);

  try {
    const originalSize = fs.statSync(inputPath).size;
    const rate = parseFloat(options.rate) || 1.0;

    if (rate < 0.5 || rate > 2.0) {
      throw new Error('Taxa de velocidade invalida. Use um valor entre 0.5 e 2.0.');
    }

    // atempo so aceita valores entre 0.5 e 2.0
    // Para valores fora, encadeia multiplos filtros atempo
    const args = [
      '-i', inputPath,
      '-af', `atempo=${rate}`,
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
    throw new Error(`Erro ao alterar velocidade do audio: ${error.message}`);
  }
}

/**
 * Adiciona fade in e/ou fade out ao audio.
 * Options: fadeIn (segundos), fadeOut (segundos)
 */
async function fade(inputPath, options = {}) {
  const outputId = uuidv4();
  const inputExt = path.extname(inputPath).slice(1) || 'mp3';
  const outputPath = path.join(TMP_DIR, `${outputId}.${inputExt}`);

  try {
    const originalSize = fs.statSync(inputPath).size;
    const fadeIn = parseFloat(options.fadeIn) || 0;
    const fadeOut = parseFloat(options.fadeOut) || 0;

    if (fadeIn <= 0 && fadeOut <= 0) {
      throw new Error('E necessario informar fadeIn e/ou fadeOut (em segundos).');
    }

    const filters = [];

    if (fadeIn > 0) {
      filters.push(`afade=t=in:st=0:d=${fadeIn}`);
    }

    if (fadeOut > 0) {
      // Precisa saber a duracao para calcular o inicio do fade out
      const totalDuration = await getDuration(inputPath);
      if (totalDuration) {
        const fadeOutStart = totalDuration - fadeOut;
        filters.push(`afade=t=out:st=${fadeOutStart}:d=${fadeOut}`);
      } else {
        // Se nao conseguir a duracao, usa fade out reverso
        filters.push(`areverse,afade=t=in:d=${fadeOut},areverse`);
      }
    }

    const args = [
      '-i', inputPath,
      '-af', filters.join(','),
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
    throw new Error(`Erro ao adicionar fade ao audio: ${error.message}`);
  }
}

module.exports = {
  convert,
  trim,
  merge,
  compress,
  volume,
  speed,
  fade,
};
