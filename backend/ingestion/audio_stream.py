"""
Streams audio from a LiveATC.net MP3 feed using ffmpeg,
yielding fixed-duration numpy float32 chunks ready for Whisper.
"""

import asyncio
import subprocess
import numpy as np
from typing import AsyncGenerator
from contextlib import suppress

SAMPLE_RATE = 16000  # Whisper expects 16kHz


async def stream_audio_chunks(
    feed_url: str, chunk_seconds: int = 30
) -> AsyncGenerator[np.ndarray, None]:
    """
    Connect to a LiveATC MP3 stream and yield audio chunks as numpy arrays.
    Each chunk is `chunk_seconds` of mono 16kHz float32 audio.
    """
    bytes_per_chunk = SAMPLE_RATE * chunk_seconds * 4  # float32 = 4 bytes

    import shutil
    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        raise RuntimeError(
            "ffmpeg not found on PATH — install ffmpeg "
            "(macOS: `brew install ffmpeg`, Ubuntu: `apt install ffmpeg`)"
        )
    cmd = [
        ffmpeg_bin,
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "5",
        "-headers", "User-Agent: WinampMPEG/5.0\r\nIcy-MetaData: 1\r\n",
        "-i", feed_url,
        "-ar", str(SAMPLE_RATE),
        "-ac", "1",           # mono
        "-f", "f32le",        # raw float32 little-endian
        "-",
    ]

    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )

    try:
        buffer = b""
        while True:
            chunk = await process.stdout.read(4096)
            if not chunk:
                break
            buffer += chunk
            while len(buffer) >= bytes_per_chunk:
                raw = buffer[:bytes_per_chunk]
                buffer = buffer[bytes_per_chunk:]
                audio = np.frombuffer(raw, dtype=np.float32)
                yield audio
    finally:
        with suppress(ProcessLookupError):
            process.kill()
        with suppress(ProcessLookupError):
            await process.wait()
