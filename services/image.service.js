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
 * Detecta a extensao de saida baseada no formato.
 */
function getExtension(format) {
  const map = {
    jpeg: 'jpg',
    jpg: 'jpg',
    png: 'png',
    webp: 'webp',
    avif: 'avif',
    tiff: 'tiff',
    tif: 'tiff',
    gif: 'gif',
  };
  return map[format] || format;
}

/**
 * Obtem metadados da imagem de saida e retorna o resultado padrao.
 */
async function buildResult(outputPath, filename, originalSize) {
  const newSize = fs.statSync(outputPath).size;
  const metadata = await sharp(outputPath).metadata();
  return {
    outputPath,
    filename,
    originalSize,
    newSize,
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
  };
}

/**
 * Comprime uma imagem reduzindo a qualidade.
 * Options: quality (1-100, padrao: 80)
 */
async function compress(inputPath, options = {}) {
  const quality = Math.max(1, Math.min(100, options.quality || 80));
  const outputId = uuidv4();
  let outputPath;

  try {
    const originalSize = fs.statSync(inputPath).size;
    const metadata = await sharp(inputPath).metadata();
    const format = metadata.format || 'jpeg';
    const ext = getExtension(format);
    outputPath = path.join(TMP_DIR, `${outputId}.${ext}`);

    let pipeline = sharp(inputPath);

    switch (format) {
      case 'jpeg':
      case 'jpg':
        pipeline = pipeline.jpeg({ quality, mozjpeg: true });
        break;
      case 'png':
        pipeline = pipeline.png({ quality, compressionLevel: 9 });
        break;
      case 'webp':
        pipeline = pipeline.webp({ quality });
        break;
      case 'avif':
        pipeline = pipeline.avif({ quality });
        break;
      case 'tiff':
        pipeline = pipeline.tiff({ quality });
        break;
      default:
        pipeline = pipeline.jpeg({ quality, mozjpeg: true });
        outputPath = path.join(TMP_DIR, `${outputId}.jpg`);
    }

    await pipeline.toFile(outputPath);
    return await buildResult(outputPath, `${outputId}.${ext}`, originalSize);
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao comprimir imagem: ${error.message}`);
  }
}

/**
 * Redimensiona uma imagem.
 * Options: width, height, fit ('cover'|'contain'|'fill'|'inside'|'outside')
 */
async function resize(inputPath, options = {}) {
  const outputId = uuidv4();
  let outputPath;

  try {
    const originalSize = fs.statSync(inputPath).size;
    const metadata = await sharp(inputPath).metadata();
    const ext = getExtension(metadata.format || 'jpg');
    outputPath = path.join(TMP_DIR, `${outputId}.${ext}`);

    if (!options.width && !options.height) {
      throw new Error('E necessario informar largura (width) e/ou altura (height).');
    }

    const resizeOptions = {
      fit: options.fit || 'inside',
      withoutEnlargement: options.withoutEnlargement !== false,
    };

    if (options.width) resizeOptions.width = parseInt(options.width, 10);
    if (options.height) resizeOptions.height = parseInt(options.height, 10);

    await sharp(inputPath)
      .resize(resizeOptions)
      .toFile(outputPath);

    return await buildResult(outputPath, `${outputId}.${ext}`, originalSize);
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao redimensionar imagem: ${error.message}`);
  }
}

/**
 * Converte imagem entre formatos.
 * Options: format ('jpg'|'png'|'webp'|'avif'|'tiff')
 */
async function convert(inputPath, options = {}) {
  const outputId = uuidv4();
  let outputPath;

  try {
    const originalSize = fs.statSync(inputPath).size;
    const format = (options.format || 'jpg').toLowerCase();
    const ext = getExtension(format);
    outputPath = path.join(TMP_DIR, `${outputId}.${ext}`);

    let pipeline = sharp(inputPath);

    switch (format) {
      case 'jpg':
      case 'jpeg':
        pipeline = pipeline.jpeg({ quality: options.quality || 90 });
        break;
      case 'png':
        pipeline = pipeline.png({ compressionLevel: 6 });
        break;
      case 'webp':
        pipeline = pipeline.webp({ quality: options.quality || 85 });
        break;
      case 'avif':
        pipeline = pipeline.avif({ quality: options.quality || 50 });
        break;
      case 'tiff':
        pipeline = pipeline.tiff({ quality: options.quality || 80 });
        break;
      default:
        throw new Error(`Formato nao suportado: ${format}. Use jpg, png, webp, avif ou tiff.`);
    }

    await pipeline.toFile(outputPath);
    return await buildResult(outputPath, `${outputId}.${ext}`, originalSize);
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao converter imagem: ${error.message}`);
  }
}

/**
 * Recorta uma imagem.
 * Options: left, top, width, height (todos em pixels)
 */
async function crop(inputPath, options = {}) {
  const outputId = uuidv4();
  let outputPath;

  try {
    const originalSize = fs.statSync(inputPath).size;
    const metadata = await sharp(inputPath).metadata();
    const ext = getExtension(metadata.format || 'jpg');
    outputPath = path.join(TMP_DIR, `${outputId}.${ext}`);

    const left = parseInt(options.left, 10) || 0;
    const top = parseInt(options.top, 10) || 0;
    const width = parseInt(options.width, 10);
    const height = parseInt(options.height, 10);

    if (!width || !height) {
      throw new Error('E necessario informar largura (width) e altura (height) para recorte.');
    }

    // Valida limites
    if (left + width > metadata.width || top + height > metadata.height) {
      throw new Error(
        `Area de recorte excede as dimensoes da imagem (${metadata.width}x${metadata.height}).`
      );
    }

    await sharp(inputPath)
      .extract({ left, top, width, height })
      .toFile(outputPath);

    return await buildResult(outputPath, `${outputId}.${ext}`, originalSize);
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao recortar imagem: ${error.message}`);
  }
}

/**
 * Rotaciona uma imagem.
 * Options: degrees (90, 180, 270), flip (boolean - vertical), flop (boolean - horizontal)
 */
async function rotate(inputPath, options = {}) {
  const outputId = uuidv4();
  let outputPath;

  try {
    const originalSize = fs.statSync(inputPath).size;
    const metadata = await sharp(inputPath).metadata();
    const ext = getExtension(metadata.format || 'jpg');
    outputPath = path.join(TMP_DIR, `${outputId}.${ext}`);

    let pipeline = sharp(inputPath);

    if (options.degrees) {
      const deg = parseInt(options.degrees, 10);
      if (![90, 180, 270].includes(deg)) {
        throw new Error('Graus de rotacao invalidos. Use 90, 180 ou 270.');
      }
      pipeline = pipeline.rotate(deg);
    }

    if (options.flip) {
      pipeline = pipeline.flip();
    }

    if (options.flop) {
      pipeline = pipeline.flop();
    }

    await pipeline.toFile(outputPath);
    return await buildResult(outputPath, `${outputId}.${ext}`, originalSize);
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao rotacionar imagem: ${error.message}`);
  }
}

/**
 * Aplica filtros a uma imagem.
 * Options: brightness (0.0-3.0), contrast (0.0-3.0), saturation (0.0-3.0),
 *          grayscale (boolean), sepia (boolean)
 */
async function filters(inputPath, options = {}) {
  const outputId = uuidv4();
  let outputPath;

  try {
    const originalSize = fs.statSync(inputPath).size;
    const metadata = await sharp(inputPath).metadata();
    const ext = getExtension(metadata.format || 'jpg');
    outputPath = path.join(TMP_DIR, `${outputId}.${ext}`);

    let pipeline = sharp(inputPath);

    // Modulate: brightness, saturation
    const modulate = {};
    if (options.brightness !== undefined) {
      modulate.brightness = parseFloat(options.brightness);
    }
    if (options.saturation !== undefined) {
      modulate.saturation = parseFloat(options.saturation);
    }
    if (Object.keys(modulate).length > 0) {
      pipeline = pipeline.modulate(modulate);
    }

    // Contraste via linear
    if (options.contrast !== undefined) {
      const contrast = parseFloat(options.contrast);
      // contrast: 1.0 = normal, >1 mais contraste, <1 menos
      pipeline = pipeline.linear(contrast, -(128 * (contrast - 1)));
    }

    // Escala de cinza
    if (options.grayscale) {
      pipeline = pipeline.grayscale();
    }

    // Sepia (tint com tom amarelado)
    if (options.sepia) {
      pipeline = pipeline.recomb([
        [0.393, 0.769, 0.189],
        [0.349, 0.686, 0.168],
        [0.272, 0.534, 0.131],
      ]);
    }

    await pipeline.toFile(outputPath);
    return await buildResult(outputPath, `${outputId}.${ext}`, originalSize);
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao aplicar filtros: ${error.message}`);
  }
}

/**
 * Adiciona borda a uma imagem usando extend do sharp.
 * Options: size (px, padrao: 10), color (hex, padrao: '#000000')
 */
async function borders(inputPath, options = {}) {
  const outputId = uuidv4();
  let outputPath;

  try {
    const originalSize = fs.statSync(inputPath).size;
    const metadata = await sharp(inputPath).metadata();
    const ext = getExtension(metadata.format || 'jpg');
    outputPath = path.join(TMP_DIR, `${outputId}.${ext}`);

    const size = parseInt(options.size, 10) || 10;
    const colorHex = (options.color || '#000000').replace('#', '');

    // Converte hex para rgb
    const r = parseInt(colorHex.substring(0, 2), 16) || 0;
    const g = parseInt(colorHex.substring(2, 4), 16) || 0;
    const b = parseInt(colorHex.substring(4, 6), 16) || 0;

    await sharp(inputPath)
      .extend({
        top: size,
        bottom: size,
        left: size,
        right: size,
        background: { r, g, b, alpha: 1 },
      })
      .toFile(outputPath);

    return await buildResult(outputPath, `${outputId}.${ext}`, originalSize);
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao adicionar borda: ${error.message}`);
  }
}

/**
 * Redimensiona imagem para uma proporcao especifica.
 * Options: ratio ('16:9'|'4:3'|'1:1'|'9:16'), maxWidth (padrao: largura original)
 */
async function aspectRatio(inputPath, options = {}) {
  const outputId = uuidv4();
  let outputPath;

  try {
    const originalSize = fs.statSync(inputPath).size;
    const metadata = await sharp(inputPath).metadata();
    const ext = getExtension(metadata.format || 'jpg');
    outputPath = path.join(TMP_DIR, `${outputId}.${ext}`);

    const ratio = options.ratio || '1:1';
    const ratioMap = {
      '16:9': 16 / 9,
      '4:3': 4 / 3,
      '1:1': 1,
      '9:16': 9 / 16,
      '3:4': 3 / 4,
      '21:9': 21 / 9,
    };

    const targetRatio = ratioMap[ratio];
    if (!targetRatio) {
      throw new Error(`Proporcao nao suportada: ${ratio}. Use 16:9, 4:3, 1:1, 9:16, 3:4 ou 21:9.`);
    }

    const currentRatio = metadata.width / metadata.height;
    let newWidth, newHeight;

    if (currentRatio > targetRatio) {
      // Imagem e mais larga que o ratio desejado - recorta largura
      newHeight = metadata.height;
      newWidth = Math.round(metadata.height * targetRatio);
    } else {
      // Imagem e mais alta que o ratio desejado - recorta altura
      newWidth = metadata.width;
      newHeight = Math.round(metadata.width / targetRatio);
    }

    // Centraliza o recorte
    const left = Math.round((metadata.width - newWidth) / 2);
    const top = Math.round((metadata.height - newHeight) / 2);

    await sharp(inputPath)
      .extract({ left, top, width: newWidth, height: newHeight })
      .toFile(outputPath);

    return await buildResult(outputPath, `${outputId}.${ext}`, originalSize);
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao ajustar proporcao: ${error.message}`);
  }
}

/**
 * Converte HEIC para JPG.
 * Options: quality (1-100, padrao: 90)
 */
async function heicToJpg(inputPath, options = {}) {
  const outputId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${outputId}.jpg`);

  try {
    const originalSize = fs.statSync(inputPath).size;
    const quality = Math.max(1, Math.min(100, options.quality || 90));

    await sharp(inputPath)
      .jpeg({ quality, mozjpeg: true })
      .toFile(outputPath);

    return await buildResult(outputPath, `${outputId}.jpg`, originalSize);
  } catch (error) {
    safeUnlink(outputPath);
    throw new Error(`Erro ao converter HEIC para JPG: ${error.message}`);
  }
}

module.exports = {
  compress,
  resize,
  convert,
  crop,
  rotate,
  filters,
  borders,
  aspectRatio,
  heicToJpg,
};
