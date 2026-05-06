'use strict';
// ============================================================
// middleware/upload.js
//
// File upload middleware using multer.
// Files stored on disk under server/uploads/
//
// Storage layout:
//   uploads/products/images/{productId}/   ← product images
//   uploads/products/documents/{productId}/← spec sheets, manuals
//
// Served statically at: GET /uploads/...
// ============================================================

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

// ── Base upload directory ─────────────────────────────────────
const UPLOAD_BASE = path.join(__dirname, '..', 'uploads');

// ── Ensure directory exists ───────────────────────────────────
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

// ── Allowed MIME types ────────────────────────────────────────
const IMAGE_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png',
  'image/webp', 'image/gif',
]);

const DOCUMENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'image/jpeg', 'image/png', 'image/webp', // images can also be documents
]);

// ── Storage engine factory ────────────────────────────────────
function makeStorage(subPath) {
  return multer.diskStorage({
    destination: (req, _file, cb) => {
      // subPath is e.g. 'products/images' — productId appended at runtime
      const productId = req.params.id || req.params.productId || 'unknown';
      const dir = ensureDir(path.join(UPLOAD_BASE, subPath, String(productId)));
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      // Sanitise filename and add timestamp to prevent collisions
      const ext      = path.extname(file.originalname).toLowerCase();
      const basename = path.basename(file.originalname, ext)
        .replace(/[^a-zA-Z0-9-_]/g, '_')
        .slice(0, 60);
      const unique   = `${Date.now()}_${basename}${ext}`;
      cb(null, unique);
    },
  });
}

// ── Product image upload ──────────────────────────────────────
const uploadProductImage = multer({
  storage: makeStorage('products/images'),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (IMAGE_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid image type: ${file.mimetype}. Allowed: JPEG, PNG, WebP, GIF`));
    }
  },
}).single('image'); // field name in FormData

// ── Product document upload ───────────────────────────────────
const uploadProductDocument = multer({
  storage: makeStorage('products/documents'),
  limits:  { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    if (DOCUMENT_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid document type: ${file.mimetype}. Allowed: PDF, Word, Excel, images`));
    }
  },
}).single('document');

// ── Wrapper to handle multer errors gracefully ────────────────
function handleUpload(uploader) {
  return (req, res, next) => {
    uploader(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, error: 'File too large.' });
        }
        return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
      }
      if (err) {
        return res.status(400).json({ success: false, error: err.message });
      }
      next();
    });
  };
}

// ── Delete file helper ────────────────────────────────────────
function deleteFile(filePath) {
  try {
    const fullPath = path.join(UPLOAD_BASE, filePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      return true;
    }
  } catch (e) {
    // Ignore — file may already be gone
  }
  return false;
}

// ── Get public URL from stored path ──────────────────────────
function getFileUrl(req, filePath) {
  const protocol = req.protocol;
  const host     = req.get('host');
  return `${protocol}://${host}/uploads/${filePath}`;
}

module.exports = {
  uploadProductImage:    handleUpload(uploadProductImage),
  uploadProductDocument: handleUpload(uploadProductDocument),
  deleteFile,
  getFileUrl,
  UPLOAD_BASE,
  ensureDir,
};
