const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const TMP_DIR = path.join(__dirname, '..', 'tmp');
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hora

/**
 * Remove arquivos do diretorio tmp que tenham mais de 1 hora.
 */
function cleanOldFiles() {
  if (!fs.existsSync(TMP_DIR)) {
    return;
  }

  const now = Date.now();

  fs.readdir(TMP_DIR, (err, files) => {
    if (err) {
      console.error('Erro ao ler diretorio tmp:', err.message);
      return;
    }

    files.forEach((file) => {
      // Ignora .gitkeep
      if (file === '.gitkeep') return;

      const filePath = path.join(TMP_DIR, file);

      fs.stat(filePath, (statErr, stats) => {
        if (statErr) return;

        if (now - stats.mtimeMs > MAX_AGE_MS) {
          fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr) {
              console.error(`Erro ao remover ${file}:`, unlinkErr.message);
            } else {
              console.log(`Limpeza: ${file} removido.`);
            }
          });
        }
      });
    });
  });
}

// Executa a cada 15 minutos
cron.schedule('*/15 * * * *', () => {
  console.log('Executando limpeza de arquivos temporarios...');
  cleanOldFiles();
});

// Executa uma vez ao iniciar
cleanOldFiles();

module.exports = { cleanOldFiles };
