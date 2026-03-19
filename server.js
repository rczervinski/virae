require('dotenv').config();

const express = require('express');
const path = require('path');
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
