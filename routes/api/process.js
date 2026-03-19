const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const upload = require(path.join(__dirname, '..', '..', 'middleware', 'upload'));
const rateLimit = require(path.join(__dirname, '..', '..', 'middleware', 'rateLimit'));
const toolsData = require(path.join(__dirname, '..', '..', 'config', 'tools.json'));

// Rate limit: 30 requisicoes por minuto
router.use(rateLimit({ maxRequests: 30, windowMs: 60 * 1000 }));

// ─── Service map ────────────────────────────────────────────
const services = {};
const serviceNames = ['pdf', 'image', 'gif', 'audio', 'video', 'convert', 'ai'];
serviceNames.forEach(name => {
  try {
    services[name] = require(path.join(__dirname, '..', '..', 'services', `${name}.service`));
  } catch (e) {
    // Service not yet implemented
    services[name] = null;
  }
});

/**
 * POST /api/process/merge-pdf
 * Recebe multiplos arquivos PDF via multer para mesclar em um unico PDF.
 */
router.post('/process/merge-pdf', upload.array('files', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Envie pelo menos 2 arquivos PDF para mesclar.'
      });
    }

    const service = services.pdf;
    if (!service || typeof service.merge !== 'function') {
      return res.status(501).json({
        success: false,
        message: 'Processamento ainda nao implementado para esta ferramenta.'
      });
    }

    // Validar extensoes
    for (const file of req.files) {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext !== '.pdf') {
        // Remover todos os arquivos enviados
        req.files.forEach(f => fs.unlink(f.path, () => {}));
        return res.status(400).json({
          success: false,
          message: `Formato nao suportado: ${file.originalname}. Apenas arquivos PDF sao aceitos.`
        });
      }
    }

    // Reordenar arquivos se order fornecido (indices separados por virgula)
    let filePaths = req.files.map(f => f.path);
    if (req.body.order) {
      const orderIndices = req.body.order.split(',').map(i => parseInt(i.trim(), 10));
      const reordered = [];
      for (const idx of orderIndices) {
        if (idx >= 0 && idx < filePaths.length) {
          reordered.push(filePaths[idx]);
        }
      }
      if (reordered.length === filePaths.length) {
        filePaths = reordered;
      }
    }

    const options = { ...req.body };
    delete options.files;
    delete options.order;

    const result = await service.merge(filePaths, options);

    res.json({
      success: true,
      message: 'Arquivos mesclados com sucesso!',
      filename: result.filename,
      downloadUrl: `/api/download/${path.basename(result.outputPath)}`,
      originalSize: result.originalSize,
      size: result.newSize
    });
  } catch (err) {
    console.error('Merge-pdf error:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Erro ao mesclar arquivos.'
    });
  }
});

/**
 * POST /api/process/:slug
 * Recebe arquivo via multer, busca a ferramenta pelo slug,
 * despacha para o servico correto e retorna resultado com URL de download.
 */
router.post('/process/:slug', upload.single('file'), async (req, res) => {
  try {
    const { slug } = req.params;
    const tool = toolsData.tools.find(t => t.slug === slug);

    if (!tool) {
      return res.status(404).json({
        success: false,
        message: 'Ferramenta nao encontrada.'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Nenhum arquivo enviado.'
      });
    }

    // Validar extensao do arquivo
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (tool.acceptedFormats.length > 0 && !tool.acceptedFormats.includes(ext)) {
      // Remover arquivo invalido
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({
        success: false,
        message: `Formato nao suportado. Formatos aceitos: ${tool.acceptedFormats.join(', ')}`
      });
    }

    const service = services[tool.processorService];
    if (!service || typeof service[tool.processorMethod] !== 'function') {
      return res.status(501).json({
        success: false,
        message: 'Processamento ainda nao implementado para esta ferramenta.'
      });
    }

    // Coletar opcoes do body (excluir campo file)
    const options = { ...req.body };
    delete options.file;
    delete options.confirmPassword; // Nao enviar confirmacao de senha ao service

    // Transformar valores de opcoes antes de enviar ao service
    if (options.degrees) {
      // "90°" -> 90
      options.degrees = parseInt(options.degrees, 10) || 90;
    }
    if (options.opacity) {
      options.opacity = parseInt(options.opacity, 10);
    }
    if (options.fontSize) {
      options.fontSize = parseInt(options.fontSize, 10);
    }
    if (options.dpi) {
      options.dpi = parseInt(options.dpi, 10);
    }

    // Mapear posicao PT-BR para EN (numerar-pdf, marca-dagua-pdf)
    if (options.position) {
      const posMap = {
        'Rodapé centro': 'bottom-center',
        'Rodapé direita': 'bottom-right',
        'Rodapé esquerda': 'bottom-left',
        'Cabeçalho centro': 'top-center',
        'Cabeçalho direita': 'top-right',
        'Cabeçalho esquerda': 'top-left',
        'Centro': 'center',
        'Topo': 'top',
        'Rodapé': 'bottom'
      };
      options.position = posMap[options.position] || options.position;
    }

    // Mapear formato de imagem (pdf-para-imagem)
    if (options.format) {
      const fmtMap = { 'PNG': 'png', 'JPG': 'jpg', 'JPEG': 'jpg' };
      options.format = fmtMap[options.format] || options.format.toLowerCase();
    }

    // Mapear pagina da assinatura
    if (options.page) {
      const pageMap = { 'Primeira': 'first', 'Última': 'last', 'Todas': 'all' };
      options.page = pageMap[options.page] || options.page;
    }

    const result = await service[tool.processorMethod](req.file.path, options);

    // Multi-file results (split-pdf, pdf-para-imagem)
    if (result.outputPaths && Array.isArray(result.outputPaths)) {
      const files = result.outputPaths.map(f => ({
        filename: f.filename,
        downloadUrl: `/api/download/${path.basename(f.outputPath)}`,
        page: f.page,
        size: f.size
      }));
      return res.json({
        success: true,
        message: `Processamento concluido! ${files.length} arquivo(s) gerado(s).`,
        files,
        totalPages: result.totalPages,
        originalSize: result.originalSize,
        size: result.newSize,
        multiFile: true
      });
    }

    res.json({
      success: true,
      message: 'Arquivo processado com sucesso!',
      filename: result.filename,
      downloadUrl: `/api/download/${path.basename(result.outputPath)}`,
      originalSize: result.originalSize,
      size: result.newSize,
      width: result.width,
      height: result.height,
      format: result.format,
      duration: result.duration,
      warning: result.warning
    });
  } catch (err) {
    console.error('Process error:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Erro ao processar arquivo.'
    });
  }
});

/**
 * POST /api/upload
 * Upload de multiplos arquivos (para ferramentas de merge/juntar).
 * Retorna lista de arquivos salvos no tmp.
 */
router.post('/upload', upload.array('files', 20), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Nenhum arquivo enviado.'
      });
    }

    const files = req.files.map(f => ({
      originalName: f.originalname,
      filename: f.filename,
      size: f.size,
      path: f.path,
      mimetype: f.mimetype
    }));

    res.json({
      success: true,
      message: `${files.length} arquivo(s) enviado(s) com sucesso.`,
      files
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Erro ao enviar arquivos.'
    });
  }
});

/**
 * GET /api/download/:filename
 * Serve arquivos processados da pasta tmp.
 */
router.get('/download/:filename', (req, res) => {
  // Sanitizar filename para evitar path traversal
  const filename = path.basename(req.params.filename);
  const filePath = path.join(__dirname, '..', '..', 'tmp', filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      message: 'Arquivo nao encontrado ou expirado.'
    });
  }

  res.download(filePath);
});

module.exports = router;
