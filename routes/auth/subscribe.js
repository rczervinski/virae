const express = require('express');
const router = express.Router();

/**
 * POST /auth/subscribe
 */
router.post('/subscribe', (req, res) => {
  // TODO: implementar integracao com gateway de pagamento
  const { plan } = req.body;

  if (!plan) {
    return res.status(400).json({
      success: false,
      message: 'Selecione um plano para continuar.'
    });
  }

  return res.json({
    success: false,
    message: 'Sistema de assinatura ainda nao implementado.'
  });
});

/**
 * GET /auth/subscribe/plans
 */
router.get('/subscribe/plans', (req, res) => {
  return res.json({
    success: true,
    plans: [
      {
        id: 'pro-mensal',
        name: 'PRO Mensal',
        price: 'R$ 19,90/mes',
        features: [
          'Sem limite de tamanho de arquivo (500 MB)',
          'Ferramentas com IA incluidas',
          'Sem anuncios',
          'Processamento prioritario'
        ]
      },
      {
        id: 'pro-anual',
        name: 'PRO Anual',
        price: 'R$ 9,90/mes (cobrado anualmente)',
        features: [
          'Tudo do plano mensal',
          'Economia de 50%',
          'Suporte prioritario'
        ]
      }
    ]
  });
});

module.exports = router;
