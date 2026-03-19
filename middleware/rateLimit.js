/**
 * Rate limiter simples em memoria.
 * @param {number} maxRequests - Numero maximo de requisicoes por janela
 * @param {number} windowMs    - Janela de tempo em milissegundos
 */
function rateLimit({ maxRequests = 30, windowMs = 60 * 1000 } = {}) {
  const hits = new Map();

  // Limpa entradas expiradas a cada minuto
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now - entry.start > windowMs) {
        hits.delete(key);
      }
    }
  }, windowMs);

  // Permite que o processo encerre sem aguardar o timer
  if (cleanup.unref) {
    cleanup.unref();
  }

  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    let entry = hits.get(key);

    if (!entry || now - entry.start > windowMs) {
      entry = { count: 1, start: now };
      hits.set(key, entry);
      return next();
    }

    entry.count += 1;

    if (entry.count > maxRequests) {
      return res.status(429).json({
        success: false,
        message: 'Muitas requisicoes. Tente novamente em alguns instantes.'
      });
    }

    next();
  };
}

module.exports = rateLimit;
