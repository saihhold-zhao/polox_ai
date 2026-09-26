---
id: talking-avatar
name: Talking Avatar
description: Guided talking-head video from aspect ratio, character (upload or generate), spoken language (English / 中文), voice (random / upload / in-chat record), speech script, first-frame still, then generate lip-sync / talking-head segments sized to each spoken segment, user segment review, then stitch.
version: 3.1.0
source: builtin
visibility: catalog
triggers:
  - /talking-avatar
requires:
  - ask_user
  - request_voice_recording
  - model_gpt_image_2_text_to_image
  - model_gpt_image_2_5_flare_image_to_image
  - model_wan_3_0_video_reference_to_video
  - concat_videos
inputs:
  - aspect_ratio
  - character_image
  - speech_language
  - voice_reference
  - speech_script
safety:
  maxGenerationsPerRun: 20
  allowSpend: true
---
# Talking Avatar

Use when the user invokes `/talking-avatar` or the Talking Avatar skill. Walk the user through a **multi-step conversational flow**, asking **one step at a time** and waiting for each reply before continuing. Do not invent uploads or URLs. Every `ask_user` question must include an **Other** option with `allow_custom: true`. Do not mix `ask_user` or `request_voice_recording` with generation or `concat_videos` in the same turn. Prefer not to mention underlying model brand names unless the user asks; still use the exact tool names below.

**All still generation in this skill runs at 2K** — character creation (step 2) uses GPT Image 2 text-to-image and first-frame generation (step 6) uses GPT Image 2.5 Flare image-to-image. Exact model ids:

- Text-to-image: `gpt-image-2-text-to-image` → tool `model_gpt_image_2_text_to_image`
- Image-to-image: `gpt-image-2-5-flare-image-to-image` → tool `model_gpt_image_2_5_flare_image_to_image`
- Always pass `resolution: "2k"` (and the aspect ratio locked in step 1).

Video generation uses Wan 3.0 reference-to-video (`model_wan_3_0_video_reference_to_video`) with an **explicit integer `duration`** per segment (2–30 seconds): estimate how long the segment's lines take to speak and add about 1 second of headroom (round up). Per-segment max is 30s without reference video; with reference video, max output = 30 − ref total seconds. Prefer natural sentence-boundary splits so each spoken segment stays safely under that max (target ≤25s spoken when unsure).

**Spoken language (locked in step 3)** drives the voice-recording sample script, the avatar speech script, and language constraints in later prompts. Write still/video **production instructions in English**; keep **spoken lines and on-screen speech text exactly in the locked spoken language**. Do not translate spoken lines into English unless the locked language is English (or the user explicitly asks to change language). Chat UI copy for this skill may stay product-English; choice labels for language must clearly offer English / 中文.

## Workflow

1. **Choose aspect ratio.** Pick 9:16 vertical for Reels, Shorts, and TikTok, or 16:9 horizontal for YouTube.
2. **Set the character.** Upload a clear single-person portrait, or generate one from a short style description.
3. **Choose spoken language.** English or Chinese (中文) — locks recording script, voiceover script, and later prompt language rules.
4. **Pick a voice.** Use a random model voice, upload a reference clip, or record a short sample in chat.
5. **Provide the speech script.** Paste your full script, or describe the topic and let the agent draft lines for you to approve (in the locked language).
6. **Create the first frame.** Choose the scene, pose, and wardrobe; generate a front-facing still that keeps the same character identity.
7. **Confirm the plan.** Review aspect ratio, character, language, voice, and the planned spoken segments, then start generation.
8. **Choose resolution.** Select 480P, 720P, or 1080P for the talking clips.
9. **Generate lip-sync segments.** Create each spoken segment as a talking-head clip from the first frame and script.
10. **Review the segments.** Check every clip and regenerate any that need changes before stitching.
11. **Stitch the final video.** Combine approved segments into one talking-head video.

## Conversational pipeline

Stop at each gate until it is answered. Do not generate ahead.

### 1. Aspect ratio

Call **ask_user** alone with question id `aspect_ratio`. Ask whether the talking video should be:

- `9_16` — **9:16 vertical** (Instagram Reels / YouTube Shorts / TikTok)
- `16_9` — **16:9 horizontal** (YouTube)
- Other with `allow_custom: true`

Recommend `9_16` for short-form social unless the user already said otherwise. Lock the chosen ratio for every later still and video. Stop and wait.

### 2. Character image

Call **ask_user** alone with question id `character_source`. Ask whether they already have a character/portrait image, or want one generated:

- `have_image` — I have a character image (I will upload it)
- `generate` — Generate a character for me
- Other with `allow_custom: true`

**If `have_image`:** In plain chat (not a choice card), ask them to send/upload one clear single-person portrait. Wait until a real uploaded image URL exists. Do not invent a URL. That upload becomes the **locked character image**.

**If `generate`:** Ask what kind of character they want (age vibe, style, wardrobe hints). Offer several concrete recommended options via **ask_user** (question id `character_style`) plus Other. Then call **`model_gpt_image_2_text_to_image`** with:

- `prompt`: English description of the character as a front-facing talking-head portrait
- `aspect_ratio`: the locked step-1 ratio (`9:16` or `16:9`)
- `resolution`: `"2k"`
- `_name`: clear title (e.g. “Talking Avatar · Character”)

The usual generation confirmation applies. After success, optionally ask_user `character_review` (`approve` / `regenerate` + Other). The approved still becomes the **locked character image**.

### 3. Spoken language

**After the character is locked and before any voice options**, call **ask_user alone** with question id `speech_language`. Ask which language the avatar should speak (this also sets the in-chat voice-recording sample language and the voiceover script language):

- `english` — **English**
- `chinese` — **中文 (Chinese)**
- Other with `allow_custom: true` (user may type another language; treat it as the locked spoken language for scripts and prompts)

Recommend based on conversation context when obvious; otherwise prefer `english` as a neutral default. Stop and wait.

**Persist / lock:** Remember the answer as the **locked spoken language** for the rest of this run. Do **not** re-ask `speech_language` on later steps unless the user explicitly asks to change language (e.g. via `change_something` on the plan card, or clear chat instructions). If they skip the card, use English and state that briefly.

Language cascades to every later step:

| Locked language | Voice recording `script` | Speech script / AI draft | Still / Wan production prompts |
| --- | --- | --- | --- |
| English (`english`) | Invent a simple **2-sentence English** reading sample | Script in **English** | Production English; spoken lines quoted in English; say the person speaks English |
| Chinese (`chinese`) | Invent a simple **2-sentence Chinese (中文)** reading sample | Script in **Chinese (中文)** | Production English; spoken lines quoted in Chinese; explicitly say the person speaks Chinese / 中文; Chinese on-screen text only if the scene needs readable text |
| Other custom | Reading sample in that language | Script in that language | Production English; quote spoken lines in that language; name the spoken language in the prompt |

### 4. Voice

Call **ask_user** alone with question id `voice_choice`. Ask which voice to use:

- `random_voice` — Random / model voice (no reference audio)
- `upload_voice` — Upload a reference voice file
- `record_voice` — Record one now in chat
- Other with `allow_custom: true`

Recommend `record_voice` when they want their own voice; `random_voice` for a quick demo. Stop and wait.

- **`upload_voice`:** Plain-chat ask for an audio upload (MP3/WAV/M4A/AAC/OGG/WEBM). Keep the voice sample short (the video model accepts at most ~15 seconds of reference audio in total). Wait for a real uploaded audio URL. Non-MP3 uploads are converted to MP3 on the server when needed. That URL is the **locked voice reference**. Do not invent a URL.
- **`record_voice`:** Call **`request_voice_recording` alone** with a `script` parameter in the **locked spoken language**: invent a **random simple 2-sentence** reading script (neutral everyday sample for cloning — **not** the avatar speech script from step 5). Examples:
  - English: “Hello, this is my voice sample. I am recording so the video can match how I speak.”
  - Chinese: “你好，这是我的声音样本。我正在录制，好让视频能匹配我说话的语气和节奏。”
  Do **not** hardcode English when Chinese (or another language) is locked. Optional `prompt` intro above the recorder may stay product-English (e.g. “Record a short voice sample…”) or match the chat language. The UI shows the script and the recorder only (no choice tiles). The user records, then taps **Finish** on the recorder. The tool result returns an **MP3** `voiceUrl` (`format: audio/mpeg`) stored locally — the server converts browser WebM/Opus recordings to MP3 automatically. That URL is the **locked voice reference** and is valid for Wan `reference_audios`. Do **not** invent a URL. Do **not** tell the user the format is unreadable or ask them to re-upload MP3/WAV for format reasons when this tool returned `ok: true`. If skipped/failed, offer upload or random voice again.
- **`random_voice`:** Leave voice reference empty (no `reference_audios` later).

### 5. Speech script

Call **ask_user alone** with question id `speech_script_source`. Offer **exactly these two** options (do not add any other script-entry choices):

- `provide_script` — **I'll provide the full speech script** (user pastes or types the lines themselves)
- `ai_write_script` — **Describe what I want; you write the script** (user describes topic, tone, length, audience, must-include points; agent drafts the lines)

Recommend whichever fits; stop and wait.

#### If `provide_script`
Ask them (plain chat) to paste the full speech script **in the locked spoken language**. Wait for the text. If they paste a different language than the lock, ask once whether to (a) keep their wording and update the locked language, or (b) translate into the locked language. Do not invent dialogue. When you have their final wording, lock the **speech script** and continue to step 6.

#### If `ai_write_script`
1. Ask (plain chat) for requirements: topic, tone, approximate length / duration, audience, any must-include lines or facts. **Do not re-ask language** — draft in the locked spoken language unless they explicitly request a change. Wait for their reply.
2. Write a complete draft speech script in chat **in the locked spoken language**. Do not invent facts they forbade; keep it speakable aloud.
3. Call **ask_user alone** with question id `speech_script_review`:
   - `approve_script` — Looks good, use this script
   - `request_changes` — Needs changes (then ask what to change)
   - Other with `allow_custom: true`
4. If `request_changes` / Other with edit notes: revise the script **in the locked language**, show the updated draft, and call `speech_script_review` again. **Iterate until `approve_script`.**
5. Only after approval, lock the **speech script** and continue to step 6 (first-frame / environment). Do not ask first-frame questions before the script is locked.

### 6. First-frame image (from character + script)

Analyze the speech script and call **ask_user** alone with question id `first_frame_scene`. Ask about environment, standing vs sitting, clothing, mood, etc. Offer **several concrete recommended options derived from the script** (plus Other). Hard rule: keep the **same person identity/face**, **facing the camera** (front-facing talking head).

Then generate the first-frame still with **`model_gpt_image_2_5_flare_image_to_image`**:

- `images`: [locked character image]
- `prompt`: English brief applying the chosen environment / pose / clothing while preserving identity and front-facing framing (head and shoulders suitable as Image 1 start frame). If the scene includes readable on-screen text, that text must be in the **locked spoken language** (Chinese characters when Chinese is locked; English when English is locked). Do not invent unrelated bilingual signage.
- `aspect_ratio`: locked step-1 ratio (`9:16` or `16:9`)
- `resolution`: `"2k"`
- `_name`: e.g. “Talking Avatar · First frame”

The usual generation confirmation applies. Optionally review with ask_user `first_frame_review` (`approve` / `regenerate` + Other). The approved still is the **locked first-frame image**.

### 7. Plan summary

Summarize in chat:

- Aspect ratio
- Character / first-frame still (mention the image is ready)
- **Spoken language** (locked)
- Voice choice (random vs reference URL present)
- Segment plan: split the speech script on natural **sentence boundaries** into N segments each safely under the Wan 3.0 per-segment max (prefer ≤25s spoken; estimate ≈130–150 wpm for English, or a comparable natural pace for Chinese). List segment number, approx seconds, and exact text **in the locked language**.

Then call **ask_user** alone with question id `plan_confirm`:

- `start_generate` — Start generating the talking video
- `change_something` — Change something (then ask what, and loop back — if they change language, re-lock `speech_language` and cascade to script/recording as needed)
- Other with `allow_custom: true`

Stop and wait. Do not generate clips until they choose to start.

### 8. Generate talking video

**On go (`start_generate`):**

1. Call **ask_user** alone with question id `resolution_choice`. Options: `480p`, `720p`, `1080p` (+ Other). Recommend `720p` unless they already stated a preference. Stop and wait.

2. For **each segment**, call **`model_wan_3_0_video_reference_to_video`** (prefer batching ready segment tools in one turn when agent rules allow multiple paid tools; otherwise one at a time). Do not mix with `ask_user` or `concat_videos` in the same turn. Parameters:

   - `reference_images`: [locked first-frame image] — this is **Image 1**, the starting frame
   - `reference_audios`: [locked voice reference] **only if** a reference voice exists; omit for random/model voice
   - `prompt`: English production instructions telling the person in the image to speak the segment’s lines (quote the spoken lines **verbatim in the locked spoken language**). Explicitly name the spoken language (e.g. “speaks English” or “speaks Chinese / 中文”). Explicitly say **Image 1 is the starting frame**. If reference audio is present, say to use **Audio1’s voice**. Instruct natural lip sync / talking to camera; keep framing consistent with the still. Do **not** translate the quoted lines into English when Chinese (or another non-English language) is locked.
   - `enable_audio`: true
   - `aspect_ratio`: locked step-1 ratio (`9:16` or `16:9`)
   - `resolution`: chosen `480p` / `720p` / `1080p`
   - `duration`: integer seconds for this segment (estimated spoken length + ~1s, rounded up, 2–30)
   - `_name`: e.g. “Lip sync · Segment 1”

   The usual generation confirmation applies.

3. **Wait for all segments.** Do not stitch yet. After every segment job has finished (including any rate-limit / transient retries that already settled), present the completed segments to the user in chat — numbered list with each clip’s link/thumbnail as the UI already shows. If a segment **failed**, regenerate that segment only after the user asks or clearly wants a retry; then continue this review loop. Do **not** auto-call `concat_videos` on “continue”, background settle, or when all clips merely succeed.

4. **Segment review (required before stitch).** Call **ask_user alone** with question id `segment_stitch_review`. Offer **exactly these** options:

   - `stitch_all` — Satisfied with all segments · stitch into one video
   - `revise_segment` — A segment needs changes

   Stop and wait. Do **not** mix with `concat_videos` or paid generation in the same turn.

   - **If `stitch_all`:** Proceed to step 5 (concat / single-clip report).
   - **If `revise_segment`:** Ask which segment number(s) and what to change (lines, pacing, framing, energy, etc.). Wait for feedback. Regenerate **only** the named segment(s) with `model_wan_3_0_video_reference_to_video` (same locked first frame, voice ref, ratio, resolution, language, and a `duration` re-estimated from the segment's lines; update the prompt from their feedback while keeping quoted speech in the locked language). When those jobs finish, present the updated clip set and call `segment_stitch_review` again. **Iterate until `stitch_all`.**

5. **Concat / report (only after `stitch_all`).** If more than one clip, call `concat_videos` alone with clips in segment order (media URLs or session video ids — never `latest`). If only one segment, skip concat. Return the final video URL. Do not auto-retry endlessly on concat failure.

## Hard rules

- One conversational gate per turn; wait for the user.
- Ask `speech_language` **after** character is set and **before** voice (random / upload / record). Lock it; do not re-ask unless the user wants to change language.
- Voice-recording `script`, AI speech-script drafts, and quoted spoken lines in Wan / first-frame prompts must follow the locked spoken language.
- `request_voice_recording` and `ask_user` must each run alone.
- Never invent media URLs; only use uploads, tool results, or session media ids.
- All stills: GPT Image 2 (character) / GPT Image 2.5 Flare (first frame), `resolution: "2k"`, locked aspect ratio.
- All talking clips: Wan 3.0 R2V with an explicit per-segment `duration`, segment then **user review** (`segment_stitch_review`) before any `concat_videos` stitch.
