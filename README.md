# RIFF

RIFF is a private, local YouTube-to-MP3 converter for Windows. It streams an audio track through a local Node.js server, then converts it to MP3 in the browser with `ffmpeg.wasm`.

## Run from source

1. Install [Node.js 22 or newer](https://nodejs.org/).
2. Double-click `Setup RIFF.cmd` to download and verify the pinned `yt-dlp` and FFmpeg runtimes.
3. Double-click `Start RIFF.cmd`.
4. Paste a YouTube URL, choose a bitrate, and download the MP3.

The server listens only on `127.0.0.1:3210`. It does not store submitted links or audio. Videos are limited to 30 minutes to keep browser memory use reasonable.

## Portable build

The downloadable Windows ZIP bundles Node.js, `yt-dlp`, and the FFmpeg WebAssembly core, so it does not require an install and the first conversion starts faster. Those runtime files are intentionally excluded from Git.

## Legal

Only download media you own or have permission to use. RIFF is not affiliated with or endorsed by YouTube. See `THIRD_PARTY_NOTICES.txt` for bundled and runtime-loaded dependencies.
