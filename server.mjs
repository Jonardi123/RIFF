import { createReadStream, existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const bundledNodePath = path.join(appDir, 'runtime', 'node.exe');
const nodePath = existsSync(bundledNodePath) ? bundledNodePath : process.execPath;
const ytdlpPath = path.join(appDir, 'runtime', 'yt-dlp.exe');
const configuredPort = Number.parseInt(process.env.RIFF_PORT || '3210', 10);
const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort < 65536 ? configuredPort : 3210;
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
  ['/runtime/ffmpeg-core.js', ['runtime/ffmpeg-core.js', 'text/javascript; charset=utf-8']],
  ['/runtime/ffmpeg-core.wasm', ['runtime/ffmpeg-core.wasm', 'application/wasm']],
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

function ytDlpError(errors) {
  const detail = Buffer.concat(errors).toString('utf8').split(/\r?\n/).filter(Boolean).at(-1);
  return new Error(detail?.replace(/^ERROR:\s*/i, '') || 'YouTube could not prepare this video.');
}

async function waitForMetadata(filePath, child, errors, getSpawnError, timeoutMs = 45000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const metadata = (await readFile(filePath, 'utf8')).trim();
      if (metadata) return metadata;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const spawnError = getSpawnError();
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw ytDlpError(errors);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  child.kill();
  throw new Error('YouTube took too long to respond. Please try again.');
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
  let child;
  let tempDirectory;
  try {
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'riff-'));
    const metadataPath = path.join(tempDirectory, 'audio.json');
    const errors = [];
    let errorBytes = 0;
    let spawnError;
    child = spawn(ytdlpPath, [
      '--no-playlist',
      '--quiet',
      '--no-warnings',
      '--no-progress',
      '--js-runtimes', `node:${nodePath}`,
      '--remote-components', 'ejs:github',
      '--format', '140/bestaudio[ext=m4a]/bestaudio',
      '--print-to-file', 'before_dl:%(.{id,title,duration,thumbnail,is_live,live_status,ext,acodec,filesize,filesize_approx})j', metadataPath,
      '--output', '-',
      sourceUrl,
    ], {
      cwd: appDir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.on('error', (error) => { spawnError = error; });
    child.stderr.on('data', (chunk) => {
      if (errorBytes >= 1024 * 1024) return;
      errors.push(chunk);
      errorBytes += chunk.length;
    });
    child.stdout.pause();

    const metadataText = await waitForMetadata(metadataPath, child, errors, () => spawnError);
    const metadata = JSON.parse(metadataText);

    if (metadata.is_live || metadata.live_status === 'is_upcoming') {
      child.kill();
      activeConversion = false;
      void rm(tempDirectory, { recursive: true, force: true });
      return json(response, 422, { error: 'Live and upcoming videos are not supported yet.' });
    }
    if (!metadata.duration) {
      child.kill();
      activeConversion = false;
      void rm(tempDirectory, { recursive: true, force: true });
      return json(response, 422, { error: 'The video duration could not be read.' });
    }
    if (metadata.duration > 30 * 60) {
      child.kill();
      activeConversion = false;
      void rm(tempDirectory, { recursive: true, force: true });
      return json(response, 422, { error: 'Choose a video under 30 minutes for browser conversion.' });
    }

    const contentTypes = { m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm', ogg: 'audio/ogg', opus: 'audio/ogg' };
    const contentType = contentTypes[metadata.ext] || 'application/octet-stream';
    const title = encodeURIComponent(metadata.title || 'Riff audio');
    const thumbnail = metadata.thumbnail ? encodeURIComponent(metadata.thumbnail) : '';
    const headers = {
      'cache-control': 'no-store',
      'content-type': contentType,
      'x-content-type-options': 'nosniff',
      'x-riff-title': title,
      'x-riff-duration': String(metadata.duration),
    };
    if (metadata.filesize || metadata.filesize_approx) headers['x-riff-size'] = String(metadata.filesize || metadata.filesize_approx);
    if (metadata.filesize) headers['content-length'] = String(metadata.filesize);
    if (thumbnail) headers['x-riff-thumbnail'] = thumbnail;
    response.writeHead(200, headers);

    let finished = false;
    const downloadTimer = setTimeout(() => {
      if (child.exitCode === null) child.kill();
      response.destroy(new Error('The audio download took too long. Please try again.'));
    }, 180000);
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(downloadTimer);
      activeConversion = false;
      if (tempDirectory) void rm(tempDirectory, { recursive: true, force: true });
    };
    child.stdout.on('error', (error) => response.destroy(error));
    child.on('close', (code) => {
      if (code !== 0 && !response.writableEnded) response.destroy(ytDlpError(errors));
      finish();
    });
    response.on('close', () => {
      if (!finished && child.exitCode === null) child.kill();
      finish();
    });
    response.on('finish', finish);
    child.stdout.pipe(response);
    return;
  } catch (error) {
    if (child && child.exitCode === null) child.kill();
    activeConversion = false;
    if (tempDirectory) void rm(tempDirectory, { recursive: true, force: true });
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
