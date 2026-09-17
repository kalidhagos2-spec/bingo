"""Generates the Amharic call-out clips the Mini App plays when a number is called.

One mp3 per ball, webapp/public/audio/am/<number>.mp3, saying the column letter and the
number in Amharic ("ቢ፣ አስራ ሁለት" for B-12). Run it again to change the voice or the wording:

    uv run --with edge-tts python webapp/scripts/make_amharic_audio.py [--voice am-ET-AmehaNeural]

The clips are committed, so neither the build nor the players' phones need a speech engine
(most phones have no Amharic voice installed, which is why this is not done in the browser).
"""

import argparse
import asyncio
from pathlib import Path

import edge_tts

OUT = Path(__file__).resolve().parent.parent / "public" / "audio" / "am"
LETTERS = ["ቢ", "አይ", "ኤን", "ጂ", "ኦ"]  # B I N G O, 15 numbers each
UNITS = ["", "አንድ", "ሁለት", "ሦስት", "አራት", "አምስት", "ስድስት", "ሰባት", "ስምንት", "ዘጠኝ"]
TENS = {10: "አስር", 20: "ሃያ", 30: "ሰላሳ", 40: "አርባ", 50: "ሃምሳ", 60: "ስልሳ", 70: "ሰባ"}


def number_words(n: int) -> str:
    """1..75 in Amharic words: 12 -> አስራ ሁለት, 40 -> አርባ, 57 -> ሃምሳ ሰባት."""
    tens, unit = divmod(n, 10)
    if tens == 0:
        return UNITS[unit]
    if unit == 0:
        return TENS[n]
    return f"{'አስራ' if tens == 1 else TENS[tens * 10]} {UNITS[unit]}"


def call_text(n: int) -> str:
    return f"{LETTERS[(n - 1) // 15]}፣ {number_words(n)}"


async def make(n: int, voice: str, rate: str, limit: asyncio.Semaphore) -> None:
    async with limit:
        for attempt in range(4):
            try:
                await edge_tts.Communicate(call_text(n), voice, rate=rate).save(str(OUT / f"{n}.mp3"))
                return
            except Exception:  # the service drops a connection now and then
                if attempt == 3:
                    raise
                await asyncio.sleep(2 * (attempt + 1))


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice", default="am-ET-MekdesNeural", help="am-ET-MekdesNeural (female) or am-ET-AmehaNeural (male)")
    parser.add_argument("--rate", default="+0%", help="speaking rate, e.g. -10%% or +10%%")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    limit = asyncio.Semaphore(4)
    await asyncio.gather(*(make(n, args.voice, args.rate, limit) for n in range(1, 76)))
    total = sum(p.stat().st_size for p in OUT.glob("*.mp3"))
    print(f"{len(list(OUT.glob('*.mp3')))} clips, {total / 1024:.0f} KB, voice {args.voice}")
    for n in (1, 12, 30, 47, 75):
        print(n, call_text(n))


if __name__ == "__main__":
    asyncio.run(main())
