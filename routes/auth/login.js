const express = require('express');
const router = express.Router();

/**
 * POST /auth/login
 */
router.post('/login', (req, res) => {
  // TODO: implementar autenticacao real
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'E-mail e senha sao obrigatorios.'
    });
  }

  return res.json({
    success: false,
    message: 'Autenticacao ainda nao implementada.'
  });
});

/**
 * POST /auth/logout
 */
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: 'Erro ao encerrar sessao.'
      });
    }
    return res.json({
      success: true,
      message: 'Sessao encerrada com sucesso.'
    });
  });
});

module.exports = router;
