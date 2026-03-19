/**
 * Middleware que verifica se o usuario logado possui plano PRO.
 * Caso nao possua, retorna 403.
 */
function isPro(req, res, next) {
  if (req.session && req.session.user && req.session.user.isPro) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'Recurso exclusivo para assinantes PRO. Faca upgrade para continuar.'
  });
}

module.exports = isPro;
