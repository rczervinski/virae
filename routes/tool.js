const express = require('express');
const path = require('path');
const router = express.Router();

const toolsData = require(path.join(__dirname, '..', 'config', 'tools.json'));

/**
 * GET /:slug — Renderiza a pagina de uma ferramenta pelo slug.
 * Deve ser montado por ultimo no server.js para nao capturar outras rotas.
 */
router.get('/:slug', (req, res) => {
  const { slug } = req.params;
  const tool = toolsData.tools.find((t) => t.slug === slug);

  if (!tool) {
    return res.status(404).render('404', {
      user: req.session?.user || null
    });
  }

  const category = toolsData.categories.find((c) => c.id === tool.category);

  res.render('tool', {
    tool,
    category: category || null,
    categories: toolsData.categories,
    allTools: toolsData.tools,
    activeCategory: tool.category,
    user: req.session?.user || null
  });
});

module.exports = router;
