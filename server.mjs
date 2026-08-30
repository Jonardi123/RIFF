import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const bundledNodePath = path.join(appDir, 'runtime', 'node.exe');
const nodePath = existsSync(bundledNodePath) ? bundledNodePath : process.execPath;
const ytdlpPath = path.join(appDir, 'runtime', 'yt-dlp.exe');
const port = 3210;
let activeConversion = false;

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/vendor/ffmpeg/index.js', ['vendor/ffmpeg/index.js', 'text/javascript; charset=utf-8']],
  ['/vendor/ffmpeg/classes.js', ['vendor/ffmpeg/classes.js', 'text/javascript; charset=utf-8']],
  ['/vendor/ffmpeg/const.js', ['vendor/ffmpeg/const.js', 'text/javascript; charset=utf-8']],
  ['/vendor/ffmpeg/errors.js', ['vendor/ffmpeg/errors.js', 'text/javascript; charset=utf-8']],
  ['/vendor/ffmpeg/types.js', ['vendor/ffmpeg/types.js', 'text/javascript; charset=utf-8']],
  ['/vendor/ffmpeg/utils.js', ['vendor/ffmpeg/utils.js', 'text/javascript; charset=utf-8']],
  ['/vendor/ffmpeg/worker.js', ['vendor/ffmpeg/worker.js', 'text/javascript; charset=utf-8']],
  ['/vendor/util/index.js', ['vendor/util/index.js', 'text/javascript; charset=utf-8']],
  ['/vendor/util/const.js', ['vendor/util/const.js', 'text/javascript; charset=utf-8']],
  ['/vendor/util/errors.js', ['vendor/util/errors.js', 'text/javascript; charset=utf-8']],
  ['/vendor/util/types.js', ['vendor/util/types.js', 'text/javascript; charset=utf-8']],
]);

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function getYouTubeId(value) {
  const parsed = new URL(value);
  const host = parsed.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] || null;
  if (!['youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) return null;
  if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
  if (parsed.pathname.startsWith('/shorts/') || parsed.pathname.startsWith('/embed/')) {
    return parsed.pathname.split('/').filter(Boolean)[1] || null;
  }
  return null;
}

function runYtDlp(args, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const child = spawn(ytdlpPath, args, {
      cwd: appDir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = [];
    const errors = [];
    let outputBytes = 0;

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('YouTube took too long to respond. Please try again.'));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > 12 * 1024 * 1024) {
        child.kill();
        reject(new Error('The video details were unexpectedly large.'));
        return;
      }
      output.push(chunk);
    });
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(output).toString('utf8'));
      } else {
        const detail = Buffer.concat(errors).toString('utf8').split(/\r?\n/).filter(Boolean).at(-1);
        reject(new Error(detail?.replace(/^ERROR:\s*/i, '') || 'YouTube could not prepare this video.'));
      }
    });
  });
}

async function handleAudio(requestUrl, request, response) {
  if (activeConversion) return json(response, 429, { error: 'Another conversion is already running. Give it a moment.' });

  const sourceUrl = requestUrl.searchParams.get('url');
  if (!sourceUrl || sourceUrl.length > 2048) return json(response, 400, { error: 'Paste a YouTube link first.' });

  let videoId;
  try {
    videoId = getYouTubeId(sourceUrl);
  } catch {
    return json(response, 400, { error: 'That does not look like a valid YouTube link.' });
  }
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return json(response, 400, { error: 'That does not look like a valid YouTube link.' });
  }

  activeConversion = true;
  try {
    const formatSelector = 'bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio';
    const metadataText = await runYtDlp([
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      '--js-runtimes', `node:${nodePath}`,
      '--remote-components', 'ejs:github',
      '--format', formatSelector,
      '--dump-single-json',
      '--skip-download',
      sourceUrl,
    ]);
    const metadata = JSON.parse(metadataText);
    const selected = metadata.requested_downloads?.[0] || metadata;

    if (metadata.is_live || metadata.live_status === 'is_upcoming') {
      activeConversion = false;
      return json(response, 422, { error: 'Live and upcoming videos are not supported yet.' });
    }
    if (!metadata.duration) {
      activeConversion = false;
      return json(response, 422, { error: 'The video duration could not be read.' });
    }
    if (metadata.duration > 30 * 60) {
      activeConversion = false;
      return json(response, 422, { error: 'Choose a video under 30 minutes for browser conversion.' });
    }
    if (!selected.url) {
      activeConversion = false;
      return json(response, 422, { error: 'YouTube did not provide an audio track for this video.' });
    }

    const sourceResponse = await fetch(selected.url, {
      redirect: 'follow',
      headers: selected.http_headers || metadata.http_headers || {},
    });
    if (!sourceResponse.ok || !sourceResponse.body) {
      throw new Error('The audio stream could not be opened. Try again in a moment.');
    }

    const contentType = sourceResponse.headers.get('content-type') || selected.mime_type || 'audio/mp4';
    const contentLength = sourceResponse.headers.get('content-length') || selected.filesize || selected.filesize_approx;
    const title = encodeURIComponent(metadata.title || 'Riff audio');
    const thumbnail = metadata.thumbnail ? encodeURIComponent(metadata.thumbnail) : '';
    const headers = {
      'cache-control': 'no-store',
      'content-type': contentType,
      'x-content-type-options': 'nosniff',
      'x-riff-title': title,
      'x-riff-duration': String(metadata.duration),
    };
    if (contentLength) headers['content-length'] = String(contentLength);
    if (thumbnail) headers['x-riff-thumbnail'] = thumbnail;
    response.writeHead(200, headers);

    const stream = Readable.fromWeb(sourceResponse.body);
    const finish = () => { activeConversion = false; };
    stream.on('error', (error) => response.destroy(error));
    response.on('close', finish);
    response.on('finish', finish);
    stream.pipe(response);
    return;
  } catch (error) {
    activeConversion = false;
    if (!response.headersSent) {
      return json(response, 502, { error: error instanceof Error ? error.message : 'YouTube could not prepare this video.' });
    }
    response.destroy(error);
  }
}

async function serveStatic(requestUrl, response) {
  const entry = staticFiles.get(requestUrl.pathname);
  if (!entry) return json(response, 404, { error: 'Not found' });
  const [relativePath, contentType] = entry;
  const filePath = path.join(appDir, relativePath);
  try {
    const details = await stat(filePath);
    response.writeHead(200, {
      'content-type': contentType,
      'content-length': String(details.size),
      'cache-control': relativePath === 'index.html' ? 'no-cache' : 'public, max-age=3600',
    });
    createReadStream(filePath).pipe(response);
  } catch {
    json(response, 404, { error: 'App file missing' });
  }
}

if (!existsSync(ytdlpPath)) {
  console.error('RIFF is missing runtime\\yt-dlp.exe. Run Setup RIFF.cmd and try again.');
  process.exit(1);
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || `127.0.0.1:${port}`}`);
  if (request.method === 'GET' && requestUrl.pathname === '/api/audio') {
    await handleAudio(requestUrl, request, response);
    return;
  }
  if (request.method === 'GET') {
    await serveStatic(requestUrl, response);
    return;
  }
  json(response, 405, { error: 'Method not allowed' });
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`;
  console.log('');
  console.log('  RIFF is running at ' + url);
  console.log('  Keep this window open while you convert. Press Ctrl+C to stop.');
  console.log('');
  if (process.env.RIFF_NO_OPEN !== '1') {
    const opener = spawn('cmd.exe', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    opener.unref();
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    const url = `http://127.0.0.1:${port}`;
    console.log('RIFF is already running. Opening it now…');
    const opener = spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true });
    opener.unref();
    setTimeout(() => process.exit(0), 500);
    return;
  }
  console.error(error);
  process.exit(1);
});
