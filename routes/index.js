const express = require('express');
const path = require('path');
const router = express.Router();

const toolsData = require(path.join(__dirname, '..', 'config', 'tools.json'));

router.get('/', (req, res) => {
  const { categories, tools } = toolsData;

  // Group tools by category id
  const grouped = {};
  tools.forEach((t) => {
    if (!grouped[t.category]) {
      grouped[t.category] = [];
    }
    grouped[t.category].push(t);
  });

  res.render('index', {
    categories,
    grouped,
    allTools: tools,
    user: req.session?.user || null
  });
});

module.exports = router;
