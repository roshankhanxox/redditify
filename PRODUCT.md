# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Solo content creators building personal channels on TikTok, YouTube Shorts, and Instagram Reels. They reach for this tool when they want to turn a text story or a long recording into a polished short-form vertical clip without paying per minute or uploading footage to a third-party cloud.

## Product Purpose

Turn any content into ready-to-publish short-form vertical video (9:16, 1080×1920) through two distinct pipelines:

1. **Reel Studio** — paste a text story, pick a voice and background, get a fully-produced reel with synced karaoke captions, title card, and gameplay loop.
2. **Clip Engine** — upload a long-form video (podcast, interview, lecture); AI transcribes it, identifies the best self-contained moments, and clips them out as standalone portrait videos with word-level captions and smart speaker crop.

Success means a creator can go from raw input to a downloadable, upload-ready video in a single automated run with no manual editing steps.

## Positioning

Free and open-source: no subscription, no per-minute charges, no third-party cloud dependency. The entire stack — transcription, LLM analysis, TTS, smart crop, caption rendering — runs on the user's own machine. Creators own their pipeline and their data.

## Operating Context

Users work alone, typically iterating on content formats (voices, caption styles, clip selection). The product runs locally or on a self-hosted server; creators trigger jobs from a browser UI and download the output MP4 to post directly to platforms.

## Capabilities and Constraints

- Two generation modes: Reel Studio (text → video) and Clip Engine (long video → clips)
- 20+ regional and personality-preset voices via ElevenLabs (premium) or edge-tts (free fallback)
- Word-level Whisper transcription (local model, no cloud call)
- Smart crop: LR-ASD (TalkNet + S3FD) active-speaker detection, processed at 25 fps internally
- Karaoke captions: word-by-word highlight with scale-pop; static captions support real color emojis via Twemoji compositing
- Quota system: 3 jobs/day, 30 jobs/month for free users; admin tier is unlimited
- Job queue: Celery + Redis; two separate workers (general / clips)
- Storage: local filesystem or S3/MinIO; presigned downloads, auto garbage collection
- No Reddit API dependency — users paste story text directly
- Original repo name is "redditify" (legacy); product display name is undecided (working title: ReelBot — user confirmed a cooler name is needed)

## Brand Commitments

**Product name: UNDECIDED.** Working title is "ReelBot" but the user has explicitly flagged this for replacement with a better, cooler name. Do not lock "ReelBot" into permanent brand artifacts until the name is chosen.

## Evidence on Hand

- Fully working implementation committed to `main`
- Feature parity across Reel Studio (Story Reel + Meme Studio templates) and Clip Engine (smart crop + karaoke captions live)
- No external brand assets (logo, color system, typography) committed yet
- Architecture and API documented in `README.md`

## Product Principles

1. **Own your pipeline.** The product runs on the creator's infrastructure — no third-party data lock-in, no metered cloud costs.
2. **One run, done.** The automation removes every manual editing step between raw input and a postable clip.
3. **Creator-native output.** Every output detail — aspect ratio, caption timing, speaker framing — is tuned to what actually performs on short-form platforms.
4. **Free first.** The free tier and open-source license are the product's market position, not an afterthought.

## Accessibility & Inclusion

No specific accessibility standard confirmed. Broad platform audience (TikTok, Shorts, Reels) implies mobile-accessible web UI is a basic expectation.
