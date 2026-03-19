const { execFile } = require('child_process');
const sharp = require('sharp');
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
            'FFmpeg nao encontrado. E necessario instalar o FFmpeg para processar GIFs.'
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
 * Verifica se o gifsicle esta disponivel.
 */
function checkGifsicle() {
  return new Promise((resolve) => {
    execFile('gifsicle', ['--version'], { timeout: 5000 }, (error) => {
      resolve(!error);
    });
  });
}

/**
 * Executa o gifsicle e retorna uma Promise.
 */
function runGifsicle(args) {
  return new Promise((resolve, reject) => {
    execFile('gifsicle', args, { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ENOENT') {
          reject(new Error('GIFSICLE_NOT_FOUND'));
          return;
        }
        reject(new Error(`Erro no gifsicle: ${stderr || error.message}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Converte video para GIF usando ffmpeg.
 * Options: fps (padrao: 10), width (padrao: 480), start (segundos), duration (segundos)
 */
async function fromVideo(inputPath, options = {}) {
  const outputId = uuidv4();
  const palettePath = path.join(TMP_DIR, `${outputId}_palette.png`);
  const outputPath = path.join(TMP_DIR, `${outputId}.gif`);

  try {
    const originalSize = fs.statSync(inputPath).size;
    const fps = parseInt(options.fps, 10) || 10;
    const width = parseInt(options.width, 10) || 480;

    // Constroi filtro base
    const filters = `fps=${fps},scale=${width}:-1:flags=lanczos`;

    // Args para input com start/duration opcionais
    const inputArgs = ['-i', inputPath];
    if (options.start !== undefined) {
      inputArgs.unshift('-ss', String(parseFloat(options.start)));
    }
    if (options.duration !== undefined) {
      inputArgs.push('-t', String(parseFloat(options.duration)));
    }

    // Passo 1: Gera paleta para melhor qualidade
    await runFFmpeg([
      ...inputArgs,
      '-vf', `${filters},palettegen=stats_mode=diff`,
      '-y',
      palettePath,
    ]);

    // Passo 2: Gera GIF usando a paleta
    await runFFmpeg([
      ...inputArgs,
      '-i', palettePath,
      '-lavfi', `${filters} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
      '-y',
      outputPath,
    ]);

    safeUnlink(palettePath);

    if (!fs.existsSync(outputPath)) {
      throw new Error('Nao foi possivel gerar o GIF. Verifique se o video e valido.');
    }

    const newSize = fs.statSync(outputPath).size;

    return {
      outputPath,
      filename: `${outputId}.gif`,
      originalSize,
      newSize,
    };
  } catch (error) {
    safeUnlink(palettePath);
    safeUnlink(outputPath);
    throw new Error(`Erro ao converter video para GIF: ${error.message}`);
  }
}

/**
 * Otimiza/comprime um GIF.
 * Tenta gifsicle primeiro, depois ffmpeg como fallback.
 * Options: colors (2-256, padrao: 128), lossy (0-200, padrao: 80)
 */
async function compress(inputPath, options = {}) {
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.gif`);

  try {
    const originalSize = fs.statSync(inputPath).size;
    const colors = Math.max(2, Math.min(256, parseInt(options.colors, 10) || 128));

    // Tenta gifsicle primeiro
    const hasGifsicle = await checkGifsicle();

    if (hasGifsicle) {
      const lossy = parseInt(options.lossy, 10) || 80;
      const args = [
        '-O3',
        `--lossy=${lossy}`,
        `--colors=${colors}`,
        '-o', outputPath,
        inputPath,
      ];

      await runGifsicle(args);

      const newSize = fs.statSync(outputPath).size;
      return {
        outputPath,
        filename: `${outputId}.gif`,
        originalSize,
        newSize,
      };
    }

    // Fallback: ffmpeg
    await runFFmpeg([
      '-i', inputPath,
      '-vf', `split[s0][s1];[s0]palettegen=max_colors=${colors}[p];[s1][p]paletteuse=dither=bayer`,
      '-y',
      outputPath,
    ]);

    const newSize = fs.statSync(outputPath).size;

    return {
      outputPath,
      filename: `${outputId}.gif`,
      originalSize,
      newSize,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao comprimir GIF: ${error.message}`);
  }
}

/**
 * Redimensiona um GIF.
 * Options: width, height
 */
async function resize(inputPath, options = {}) {
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.gif`);

  try {
    const originalSize = fs.statSync(inputPath).size;

    if (!options.width && !options.height) {
      throw new Error('E necessario informar largura (width) e/ou altura (height).');
    }

    const width = parseInt(options.width, 10) || -1;
    const height = parseInt(options.height, 10) || -1;

    // Tenta gifsicle primeiro
    const hasGifsicle = await checkGifsicle();

    if (hasGifsicle && options.width) {
      const args = [
        `--resize-width=${width}`,
        '-o', outputPath,
        inputPath,
      ];
      await runGifsicle(args);
    } else {
      // ffmpeg fallback
      const scaleW = width > 0 ? width : -1;
      const scaleH = height > 0 ? height : -1;

      await runFFmpeg([
        '-i', inputPath,
        '-vf', `scale=${scaleW}:${scaleH}:flags=lanczos`,
        '-y',
        outputPath,
      ]);
    }

    const newSize = fs.statSync(outputPath).size;

    return {
      outputPath,
      filename: `${outputId}.gif`,
      originalSize,
      newSize,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao redimensionar GIF: ${error.message}`);
  }
}

/**
 * Altera a velocidade de um GIF.
 * Options: rate (0.5 = mais lento, 2.0 = mais rapido, padrao: 1.0)
 */
async function speed(inputPath, options = {}) {
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.gif`);

  try {
    const originalSize = fs.statSync(inputPath).size;
    const rate = parseFloat(options.rate) || 1.0;

    if (rate < 0.25 || rate > 4.0) {
      throw new Error('Taxa de velocidade invalida. Use um valor entre 0.25 e 4.0.');
    }

    // Tenta gifsicle primeiro (mais preciso para GIFs)
    const hasGifsicle = await checkGifsicle();

    if (hasGifsicle) {
      // gifsicle usa delay em centesimos de segundo
      // Para acelerar, diminui o delay; para desacelerar, aumenta
      const delayFactor = Math.round(100 / rate);
      // #-1 = all frames
      const args = [
        `-d${Math.max(1, Math.round(delayFactor / 10))}`,
        '-o', outputPath,
        inputPath,
      ];
      await runGifsicle(args);
    } else {
      // ffmpeg: ajusta PTS
      const pts = (1 / rate).toFixed(4);
      await runFFmpeg([
        '-i', inputPath,
        '-vf', `setpts=${pts}*PTS`,
        '-y',
        outputPath,
      ]);
    }

    const newSize = fs.statSync(outputPath).size;

    return {
      outputPath,
      filename: `${outputId}.gif`,
      originalSize,
      newSize,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao alterar velocidade do GIF: ${error.message}`);
  }
}

/**
 * Reverte a animacao de um GIF.
 */
async function reverse(inputPath, options = {}) {
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.gif`);

  try {
    const originalSize = fs.statSync(inputPath).size;

    // Tenta gifsicle primeiro
    const hasGifsicle = await checkGifsicle();

    if (hasGifsicle) {
      // Precisamos saber o numero de frames
      // Usa gifsicle --info para contar
      const infoResult = await new Promise((resolve) => {
        execFile('gifsicle', ['--info', inputPath], { timeout: 10000 }, (error, stdout) => {
          if (error) {
            resolve(null);
            return;
          }
          const match = stdout.match(/(\d+) images?/i);
          resolve(match ? parseInt(match[1], 10) : null);
        });
      });

      if (infoResult && infoResult > 0) {
        // Gera a sequencia reversa: #N-1 #N-2 ... #0
        const frameRange = [];
        for (let i = infoResult - 1; i >= 0; i--) {
          frameRange.push(`#${i}`);
        }

        await runGifsicle([
          inputPath,
          ...frameRange,
          '-o', outputPath,
        ]);

        const newSize = fs.statSync(outputPath).size;
        return {
          outputPath,
          filename: `${outputId}.gif`,
          originalSize,
          newSize,
        };
      }
    }

    // Fallback: ffmpeg
    await runFFmpeg([
      '-i', inputPath,
      '-vf', 'reverse',
      '-y',
      outputPath,
    ]);

    const newSize = fs.statSync(outputPath).size;

    return {
      outputPath,
      filename: `${outputId}.gif`,
      originalSize,
      newSize,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao reverter GIF: ${error.message}`);
  }
}

/**
 * Converte GIF para WebP.
 * Options: quality (1-100, padrao: 80)
 */
async function toWebp(inputPath, options = {}) {
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.webp`);

  try {
    const originalSize = fs.statSync(inputPath).size;
    const quality = Math.max(1, Math.min(100, parseInt(options.quality, 10) || 80));

    // Tenta sharp primeiro (suporta GIF animado para WebP animado)
    try {
      await sharp(inputPath, { animated: true })
        .webp({ quality })
        .toFile(outputPath);

      const newSize = fs.statSync(outputPath).size;
      return {
        outputPath,
        filename: `${outputId}.webp`,
        originalSize,
        newSize,
      };
    } catch (sharpError) {
      // Se sharp falhar (ex: GIF muito grande), tenta ffmpeg
      safeUnlink(outputPath);
    }

    // Fallback: ffmpeg
    await runFFmpeg([
      '-i', inputPath,
      '-vcodec', 'libwebp',
      '-lossless', '0',
      '-compression_level', '6',
      '-q:v', String(quality),
      '-loop', '0',
      '-preset', 'default',
      '-an',
      '-vsync', '0',
      '-y',
      outputPath,
    ]);

    const newSize = fs.statSync(outputPath).size;

    return {
      outputPath,
      filename: `${outputId}.webp`,
      originalSize,
      newSize,
    };
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao converter GIF para WebP: ${error.message}`);
  }
}

module.exports = {
  fromVideo,
  compress,
  resize,
  speed,
  reverse,
  toWebp,
};
