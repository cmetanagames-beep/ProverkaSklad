const Busboy = require('busboy');

class MultipartReader {
  constructor({ maxFiles = 60, maxFileBytes = 10 * 1024 * 1024 } = {}) {
    this.maxFiles = maxFiles;
    this.maxFileBytes = maxFileBytes;
  }

  read(req) {
    return new Promise((resolve, reject) => {
      const fields = {};
      const files = [];
      const parser = Busboy({ headers: req.headers, limits: { files: this.maxFiles, fileSize: this.maxFileBytes, fields: 30, fieldSize: 32 * 1024 } });
      parser.on('field', (name, value) => { fields[name] = value; });
      parser.on('file', (name, stream, info) => {
        const chunks = [];
        let truncated = false;
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('limit', () => { truncated = true; });
        stream.on('end', () => {
          if (truncated) return reject(new Error('PHOTO_TOO_LARGE'));
          files.push({ name, filename: info.filename || 'photo.jpg', mime: info.mimeType || 'image/jpeg', buffer: Buffer.concat(chunks) });
        });
      });
      parser.on('filesLimit', () => reject(new Error('TOO_MANY_PHOTOS')));
      parser.on('error', reject);
      parser.on('close', () => resolve({ fields, files }));
      req.pipe(parser);
    });
  }
}

module.exports = { MultipartReader };
