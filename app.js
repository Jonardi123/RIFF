const form = document.querySelector('#converter-form');
const input = document.querySelector('#youtube-url');
const fieldset = document.querySelector('#quality-fieldset');
const convertButton = document.querySelector('#convert-button');
const progressBox = document.querySelector('#progress-box');
const progressBar = document.querySelector('#progress-bar');
const progressLabel = document.querySelector('#progress-label');
const progressValue = document.querySelector('#progress-value');
const message = document.querySelector('#message');
const result = document.querySelector('#result');
const panelTitle = document.querySelector('#panel-title');
const statusIcon = document.querySelector('#status-icon');
const trackTitle = document.querySelector('#track-title');
const trackMeta = document.querySelector('#track-meta');
const thumbnail = document.querySelector('#thumbnail');
const trackPlaceholder = document.querySelector('#track-placeholder');
const downloadButton = document.querySelector('#download-button');
const resetButton = document.querySelector('#reset-button');
const qualityButtons = [...document.querySelectorAll('[data-quality]')];

let quality = '192';
let ffmpeg;
let ffmpegPromise;
let ffmpegProgressReady = false;
let currentDownloadUrl;

qualityButtons.forEach((button) => {
  button.addEventListener('click', () => {
    quality = button.dataset.quality;
    qualityButtons.forEach((item) => item.classList.toggle('selected', item === button));
  });
});

function validYouTubeUrl(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./, '');
    return ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host);
  } catch {
    return false;
  }
}

function safeFilename(value) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'riff-audio';
}

function setProgress(percent, label) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  progressBar.style.width = `${value}%`;
  progressValue.textContent = `${value}%`;
  if (label) progressLabel.textContent = label;
}

function showError(text) {
  message.textContent = `⚠ ${text}`;
  message.classList.add('error');
}

async function readAudio(response) {
  const total = Number(response.headers.get('content-length') || response.headers.get('x-riff-size') || 0);
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    setProgress(total ? 8 + (received / total) * 28 : Math.min(34, 8 + chunks.length));
  }
  const output = new Uint8Array(received);
  let offset = 0;
  chunks.forEach((chunk) => { output.set(chunk, offset); offset += chunk.byteLength; });
  return output;
}

async function getFfmpeg() {
  if (ffmpeg?.loaded) return ffmpeg;
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import('/vendor/ffmpeg/index.js');
      ffmpeg ||= new FFmpeg();
      if (!ffmpegProgressReady) {
        ffmpeg.on('progress', ({ progress }) => setProgress(44 + progress * 52));
        ffmpegProgressReady = true;
      }
      await ffmpeg.load({
        coreURL: '/runtime/ffmpeg-core.js',
        wasmURL: '/runtime/ffmpeg-core.wasm',
      });
      return ffmpeg;
    })().catch((error) => {
      ffmpegPromise = undefined;
      throw error;
    });
  }
  return ffmpegPromise;
}

function warmConverter() {
  void getFfmpeg().catch(() => {});
}

input.addEventListener('focus', warmConverter, { once: true });
input.addEventListener('paste', warmConverter, { once: true });
if ('requestIdleCallback' in window) {
  window.requestIdleCallback(warmConverter, { timeout: 1200 });
} else {
  setTimeout(warmConverter, 350);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const sourceUrl = input.value.trim();
  if (!validYouTubeUrl(sourceUrl)) return showError('Paste a valid YouTube or youtu.be link.');

  if (currentDownloadUrl) URL.revokeObjectURL(currentDownloadUrl);
  message.classList.remove('error');
  message.textContent = 'Only convert content you own or have permission to download.';
  input.disabled = true;
  fieldset.disabled = true;
  convertButton.hidden = true;
  progressBox.hidden = false;
  setProgress(7, 'Fetching the audio track…');

  try {
    const converterPromise = getFfmpeg();
    const response = await fetch(`/api/audio?url=${encodeURIComponent(sourceUrl)}`);
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || 'That video could not be prepared. Try another public video.');
    }
    const title = decodeURIComponent(response.headers.get('x-riff-title') || 'Riff audio');
    const thumbnailHeader = response.headers.get('x-riff-thumbnail');
    const thumbnailUrl = thumbnailHeader ? decodeURIComponent(thumbnailHeader) : '';
    const mimeType = response.headers.get('content-type') || 'audio/mp4';
    const extension = mimeType.includes('webm') ? 'webm' : mimeType.includes('ogg') ? 'ogg' : 'm4a';
    const audio = await readAudio(response);

    setProgress(38, 'Warming up the converter…');
    const converter = await converterPromise;
    setProgress(44, 'Polishing your MP3…');
    const inputName = `input.${extension}`;
    const outputName = 'output.mp3';
    await converter.writeFile(inputName, audio);
    await converter.exec(['-i', inputName, '-vn', '-b:a', `${quality}k`, '-map_metadata', '-1', outputName]);
    const data = await converter.readFile(outputName);
    if (typeof data === 'string') throw new Error('The converter returned an unexpected file.');
    const bytes = new Uint8Array(data).slice();
    currentDownloadUrl = URL.createObjectURL(new Blob([bytes.buffer], { type: 'audio/mpeg' }));
    await Promise.allSettled([converter.deleteFile(inputName), converter.deleteFile(outputName)]);

    trackTitle.textContent = title;
    trackMeta.textContent = `MP3 · ${quality} kbps`;
    if (thumbnailUrl) {
      thumbnail.src = thumbnailUrl;
      thumbnail.hidden = false;
      trackPlaceholder.hidden = true;
    }
    downloadButton.href = currentDownloadUrl;
    downloadButton.download = `${safeFilename(title)}.mp3`;
    form.hidden = true;
    result.hidden = false;
    panelTitle.textContent = 'Your MP3 is ready';
    statusIcon.textContent = '✓';
  } catch (error) {
    input.disabled = false;
    fieldset.disabled = false;
    convertButton.hidden = false;
    progressBox.hidden = true;
    showError(error instanceof Error ? error.message : 'Something went wrong while converting this link.');
  }
});

resetButton.addEventListener('click', () => {
  if (currentDownloadUrl) URL.revokeObjectURL(currentDownloadUrl);
  currentDownloadUrl = undefined;
  input.value = '';
  input.disabled = false;
  fieldset.disabled = false;
  convertButton.hidden = false;
  progressBox.hidden = true;
  result.hidden = true;
  form.hidden = false;
  thumbnail.hidden = true;
  trackPlaceholder.hidden = false;
  panelTitle.textContent = 'Drop your link';
  statusIcon.textContent = '♫';
  message.classList.remove('error');
  message.textContent = 'Only convert content you own or have permission to download.';
  setProgress(0, 'Fetching the audio track…');
  input.focus();
});
