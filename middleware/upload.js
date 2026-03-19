const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const TMP_DIR = path.join(__dirname, '..', 'tmp');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, TMP_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50 MB
  }
});

module.exports = upload;
