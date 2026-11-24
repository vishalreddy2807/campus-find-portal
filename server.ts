import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
const MAX_UPLOAD_BYTES = 2.5 * 1024 * 1024;

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.use(express.json({ limit: '4mb' }));

const ALLOWED_IMAGE_TYPES: Record<string, { ext: string; magic: (buf: Buffer) => boolean }> = {
  'image/png': {
    ext: 'png',
    magic: (buf) =>
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47,
  },
  'image/jpeg': {
    ext: 'jpg',
    magic: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
  'image/jpg': {
    ext: 'jpg',
    magic: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
  'image/webp': {
    ext: 'webp',
    magic: (buf) =>
      buf.length >= 12 &&
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  'image/gif': {
    ext: 'gif',
    magic: (buf) =>
      buf.length >= 6 &&
      (buf.subarray(0, 6).toString('ascii') === 'GIF87a' ||
        buf.subarray(0, 6).toString('ascii') === 'GIF89a'),
  },
};

const CAMPUS_ZONES = [
  {
    zone: 'Main Library',
    spots: ['Ground Floor Reading Room', '2nd Floor Quiet Study Wing', 'Digital Media Lab', 'Front Checkout Desk'],
  },
  {
    zone: 'Engineering & CS Block',
    spots: ['CSE Lab 304', 'Lecture Hall E-102', 'Robotics Workshop', 'Atrium Bench Area'],
  },
  {
    zone: 'Student Commons',
    spots: ['Main Lobby', 'Study Lounge', 'Campus Bookstore', 'Student Union Office'],
  },
  {
    zone: 'Science Laboratories',
    spots: ['Chemistry Wing B2', 'Physics Instrumentation Lab', 'Biology Lecture Theater'],
  },
  {
    zone: 'Cafeteria & Dining',
    spots: ['Central Food Court', 'North Coffee Kiosk', 'Outdoor Courtyard Tables'],
  },
  {
    zone: 'Sports & Recreation',
    spots: ['Indoor Gymnasium', 'Athletics Track Bleachers', 'Swimming Pool Lockers'],
  },
  {
    zone: 'Residence Hostels',
    spots: ['North Hall Reception', 'South Block Common Room', 'Laundry Room'],
  },
  {
    zone: 'Administrative Block',
    spots: ['Registrar Counter', 'Academic Advising Office', 'Campus Security Lost & Found Desk'],
  },
  {
    zone: 'Parking & Gates',
    spots: ['Main North Gate', 'Student Bicycle Rack', 'East Visitor Lot'],
  },
];

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'campus-find-api' });
});

app.get('/api/campus-locations', (_req, res) => {
  res.json({ zones: CAMPUS_ZONES });
});

app.post('/api/upload', (req, res) => {
  try {
    const { dataUrl } = req.body as { dataUrl?: unknown };
    if (typeof dataUrl !== 'string') {
      res.status(400).json({ error: 'Missing valid image payload.' });
      return;
    }

    const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(
      dataUrl.trim()
    );
    if (!match) {
      res.status(400).json({ error: 'Only PNG, JPEG, WEBP, or GIF images are supported.' });
      return;
    }

    const mime = match[1].toLowerCase();
    const base64Data = match[2];
    const validator = ALLOWED_IMAGE_TYPES[mime];
    if (!validator) {
      res.status(400).json({ error: 'Unsupported image format.' });
      return;
    }

    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) {
      res.status(400).json({ error: 'Image must be smaller than 2.5 MB.' });
      return;
    }

    if (!validator.magic(buffer)) {
      res.status(400).json({ error: 'File contents do not match the declared image format.' });
      return;
    }

    const filename = `${crypto.randomUUID()}.${validator.ext}`;
    const targetPath = path.resolve(UPLOADS_DIR, filename);
    if (!targetPath.startsWith(UPLOADS_DIR + path.sep)) {
      res.status(400).json({ error: 'Invalid upload destination.' });
      return;
    }

    fs.writeFileSync(targetPath, buffer);
    res.status(201).json({ url: `/uploads/${filename}` });
  } catch {
    res.status(500).json({ error: 'Failed to store uploaded image.' });
  }
});

app.get('/uploads/:filename', (req, res) => {
  const filename = req.params.filename;
  if (!/^[a-f0-9-]+\.(png|jpg|webp|gif)$/i.test(filename)) {
    res.status(400).json({ error: 'Invalid filename.' });
    return;
  }

  const resolvedPath = path.resolve(UPLOADS_DIR, filename);
  if (!resolvedPath.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(resolvedPath)) {
    res.status(404).json({ error: 'Image not found.' });
    return;
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(resolvedPath);
});

app.get('/api/download-zip', (_req, res) => {
  const zipPath = path.resolve(process.cwd(), 'campus-find-portal.zip');
  if (!fs.existsSync(zipPath)) {
    res.status(404).json({ error: 'Project archive is not available.' });
    return;
  }
  res.download(zipPath, 'campus-find-portal.zip');
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Campus Find server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Campus Find server:', err);
  process.exit(1);
});
