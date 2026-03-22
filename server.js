require('dotenv').config();

const express = require('express');
const path = require('path');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');
const sessionMiddleware = require(path.join(__dirname, 'middleware', 'session'));

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Serve pdfjs-dist for client-side PDF preview
app.use('/vendor/pdfjs', express.static(path.join(__dirname, 'node_modules', 'pdfjs-dist')));

// Virae PDF Engine reverse proxy
// STIRLING_CONTEXT_PATH must match SYSTEM_ROOTURIPATH on the container
// Default: /engine/pdf (matches docker-compose.yml with Stirling v0.46.2)
// For official latest image use STIRLING_CONTEXT_PATH=/stirling
const STIRLING_URL = process.env.STIRLING_PDF_URL || 'http://localhost:8080';
const STIRLING_CTX = process.env.STIRLING_CONTEXT_PATH || '/engine/pdf';
app.use('/engine/pdf', createProxyMiddleware({
  target: STIRLING_URL,
  changeOrigin: true,
  selfHandleResponse: true,
  pathRewrite: (path) => STIRLING_CTX + path,
  on: {
    proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
      delete proxyRes.headers['x-frame-options'];
      delete proxyRes.headers['content-security-policy'];
      // Rewrite context path in HTML/JS so browser assets resolve correctly
      const contentType = proxyRes.headers['content-type'] || '';
      if (STIRLING_CTX !== '/engine/pdf' && (contentType.includes('text/html') || contentType.includes('javascript'))) {
        return responseBuffer.toString('utf8')
          .replaceAll(STIRLING_CTX + '/', '/engine/pdf/')
          .replaceAll("'" + STIRLING_CTX + "'", "'/engine/pdf'");
      }
      return responseBuffer;
    })
  }
}));

// Session
app.use(sessionMiddleware);

// Routes
app.use('/', require(path.join(__dirname, 'routes', 'index')));
app.use('/', require(path.join(__dirname, 'routes', 'tool')));
app.use('/api', require(path.join(__dirname, 'routes', 'api', 'process')));
app.use('/auth', require(path.join(__dirname, 'routes', 'auth', 'login')));
app.use('/auth', require(path.join(__dirname, 'routes', 'auth', 'subscribe')));

// 404
app.use((req, res) => {
  res.status(404).render('404', {
    user: req.session?.user || null
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
});

// Start cleanup cron
require(path.join(__dirname, 'services', 'cleanup.service'));

app.listen(PORT, () => {
  console.log(`Virae rodando na porta ${PORT}`);
});

module.exports = app;
