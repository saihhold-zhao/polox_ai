---
id: skill-creator
name: Skill Creator
description: Guided flow to author, validate, and save an L1 user skill that only orchestrates existing tools.
version: 1.2.0
source: builtin
visibility: catalog
triggers:
  - /skill-creator
requires:
  - ask_user
  - load_skill
  - save_user_skill
  - check_skill_id
  - exit_skill_creator
inputs: []
safety:
  maxGenerationsPerRun: 1
  allowSpend: false
---

# Skill Creator (L1)

Use when the user invokes `/skill-creator`, chooses **Create Skill** on the homepage, or asks to create a custom skill. This meta-skill helps them design an L1 skill that **only orchestrates already-registered tools** — no custom code and no custom UI cards.

## Hard limits (say these early)

- L1 skills cannot recreate specialty UIs that need boxes, masks, or coordinate editors (Image Layer Splitter, Image Text Editor, Image Object Removal, Sketch to Image, Annotated Image Edit, etc.). For those, compose the existing `/skill-id` or ask them to open a GitHub Issue for new UI.
- User skills **must not** reuse builtin skill ids.
- **Skill id and `/` triggers must be English kebab-case** (`/^[a-z][a-z0-9-]{1,63}$/`).
- **Display name and catalog description must be English** for every candidate you invent (option labels and their short descriptions). Do not offer non-English name/description recommendations. If the user types Other in another language, gently ask for an English version before saving.
- **Never exit while the skill is still `untitled-*` / "Untitled Skill".** Choose a real display name and `/` trigger (via `check_skill_id`) and save them **before** the exit ask_user.
- `requires` may only list registered tool names (`ask_user`, `generate_image`, `generate_video`, `remove_background`, `concat_videos`, `measure_video_duration`, `extract_video_frame`, `inspect_website`, `export_zip`, `load_skill`, `save_user_skill`, `check_skill_id`, `exit_skill_creator`, and `model_*` tools). Only this meta-skill may call `save_user_skill` / `exit_skill_creator`.
- Cap generations with `safety.maxGenerationsPerRun` (default 3, max 20).
- Imports arrive **disabled** until the user enables them.
- **Skill Creator only edits/saves skill content.** Do **not** ask about enable/disable/delete mid-flow. Final exit always **Enables** the skill.

## Flow (follow this order)

### 1–4. Discover the need — do **not** invent id / name yet

Keep asking clarifying questions with `ask_user` until the requirement is solid. **Do not recommend a skill id, display name, or catalog description during these steps.**

### 5. Any more changes?

After the requirement looks solid, call `ask_user` once with question id `more_changes` (nothing else vs they will describe more). Loop until they confirm nothing else.

### 6. Choose display name and `/` trigger (only after step 5)

1. Invent **2–3** candidate pairs of:
   - display **name** (**English only** — short product-style title, e.g. Motion Transfer Video)
   - English kebab-case **id** (same as `/id` trigger)
   - Each name option's short description must also be **English** (e.g. Clear and descriptive.)
2. **Before** showing them, call `check_skill_id` for **each** candidate (`id` + `name`).
3. Only offer candidates where both `id.ok` and `name.ok` are true.
4. Show one `ask_user` for the **display name** and **`/` trigger / id** (include Other).
5. **If the user picks Other / types custom text:** call `check_skill_id` on their input immediately. If taken/invalid, tell them and ask again with free alternatives.
6. When renaming an existing skill, pass `except_skill_id` as the current id so its own id/name stay allowed.
7. **Reject staying on `untitled-*` / "Untitled Skill".** Do not proceed to exit until a real name and kebab-case id are chosen and saved.

### 7. Catalog description (after name and `/` trigger)

Call `ask_user` once with question id `skill_description`. Offer 2–3 short **English** candidates plus Other (never propose non-English description options). Use the confirmed line as frontmatter `description`.

### 8. Cover image (optional — keep simple)

Call `ask_user` once with question id `skill_cover`:

- `skip_cover` — Skip for now (default / preferred when unsure). Omit `cover` on save.
- `upload_cover` — They will upload an image in chat; wait for the HTTPS URL.
- Cover generation is optional; skipping is fine.

### 9. Save progress (may stay draft until the final exit)

1. Produce a complete `SKILL.md` with the confirmed id, name, and description from steps 6–7. Prefer keeping the draft brief in chat; do not dump the full markdown unless they ask.
2. Call `save_user_skill` with `overwrite: true` when updating the bound draft / existing id. WIP may use draft; finishing uses `enabled: true`.
   - Re-check with `check_skill_id` first when proposing or renaming.
   - On validation errors, fix and retry with the **same** final id (never leave a second untitled card).
3. Do **not** ask about enable/disable/delete.

### 10. Category — Utility or Fun (last question before the exit)

**First judge the category yourself** from the confirmed purpose and content of the skill (do this silently, before asking):

- **Utility** — functional / productivity: editing, design or marketing assets, documents, conversions, business or practical output.
- **Fun** — entertainment / playful / novelty: memes, jokes, character or pet play, avatars for fun, games, surprise effects, just-for-fun creations.
- If it is genuinely mixed or unclear, judge **Utility**.

Then, right before the final exit, call `ask_user` with question id `skill_category` (every time — new skills and edits) and let the user choose:

- Prompt: which homepage Skills category this skill belongs in.
- Options (exactly these two ids, no Other needed):
  - `utility` — label **Utility**; description: functional / productivity use.
  - `fun` — label **Fun**; description: entertainment / playful use.
- Mark your judgment as recommended:
  - Put the judged option **first**.
  - Set the question's `recommended` field to its id. The card then shows a "Suggested" badge.
  - Append ` (Recommended)` to its label, e.g. `Utility (Recommended)`.
  - Replace its description with a **one-line reason** tied to this skill, e.g. `Recommended: it produces App Store marketing graphics — a practical, productivity task.`
  - The other option keeps its plain label and generic description.
- When editing, `INTERNAL_EDIT_CONTEXT` includes `Current skill category`. Re-judge from the (possibly changed) purpose; if your judgment differs from the current category, mention that briefly in the reason.
- **Save the user's choice, not your judgment**. The chosen option id is `utility` or `fun` (ignore the "(Recommended)" label text). Pass it on the final save in step 11 (`save_user_skill` `category: "utility" | "fun"`) and on `exit_skill_creator` (`category`). If they skip the question, use your recommended id. Category is stored on the skill record, not in SKILL.md, so always pass it via the tool field.
- You may ask `skill_category` and `exit_skill_creator` in the **same** `ask_user` call (two questions: `skill_category` first, then `exit_skill_creator`) to keep the finish to one step.

### 11. Exit — Enable & leave, or Enable & test

**Prerequisite:** the skill already has a final non-untitled id and display name (step 6 saved). Never call `exit_skill_creator` while id still matches `untitled-*` or name is still "Untitled Skill…".

After the skill content is ready and the category is chosen, call `ask_user` once with question id `exit_skill_creator` (or combine with step 10 as described above):

- **Wording ban:** Never say "Publish", "Published", or "Publishing" in any user-facing text. Always say **Enable** / **Enabled** / **Enabling**.
- Prompt example: `The update is ready to save. If you skip, I'll enable and open Test mode so you can verify.`
- Question prompt example: `Ready to save. How do you want to finish?`
- Options (exactly these two ids; copy the labels/descriptions verbatim):
  - `test_now` — label: **Enable & test now** — description: **Enable the updated skill and open Test mode so you can try it again.**
  - `save_and_exit` — label: **Enable & exit** — description: **Enable the updated skill and return to Skills.**
- For either choice:
  1. Call `save_user_skill` with `enabled: true` (and overwrite when updating) using the **final** id/name, and `category` from step 10.
  2. Then call `exit_skill_creator` with the matching action (`save_and_exit` or `test_now`) and the same `category`.
- The exit tool force-enables the bound skill (`status: published`, `enabled: true`), then navigates:
  - `save_and_exit` → `/skills`
  - `test_now` → `/projects/<projectId>?mode=agent&skillMode=test` (UI must switch to the Test tab)
- In chat, say the skill is **enabled**, never published.

## SKILL.md template

```markdown
---
id: my-skill
name: My Skill
description: One-line catalog summary of when to use it.
version: 1.0.0
source: user
visibility: catalog
triggers:
  - /my-skill
requires:
  - ask_user
  - generate_image
inputs: []
safety:
  maxGenerationsPerRun: 3
  allowSpend: true
---

# My Skill

When to use this skill…

## Steps
1. …
```

## Edit Existing Skill

When the user opens **Edit** from Skills (`/skills`), the composer is prefilled with the current skill markdown and id. Treat that as an **in-place update**:

1. Read the provided `Current skill id` and markdown fence — do not invent a new id.
2. Discuss the requested changes with `ask_user` when intent is unclear.
3. Produce an updated `SKILL.md` that keeps the same `id` (unless they explicitly ask to rename — then follow step 6 with `except_skill_id`).
4. Confirm with `ask_user`, then call `save_user_skill` with that same id (`enabled: true` when finishing).
5. Ask the category with step 10: judge Utility / Fun yourself first, then ask `skill_category` with your judgment first, marked `recommended`, with a one-line reason. Save the user's choice.
6. Finish with the exit ask_user (`save_and_exit` or `test_now`), saving with the chosen `category`, then call `exit_skill_creator` with that action and `category`.

Never create a duplicate skill when an edit brief is present. If validation fails, fix the draft and retry `save_user_skill` with the same id.

## Style

Be concise. Use `ask_user` for decisions. Never invent tool names. Never claim a specialty box/mask UI was created.
