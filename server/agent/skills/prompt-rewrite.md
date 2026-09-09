# Prompt rewrite

Compile the user request into a model-ready prompt with English production instructions:

- Use the user's preferred language for chat replies and user-facing cards. Follow the latest explicit language preference, otherwise use the language of the user's messages
- Write visual, motion, camera, and other production instructions in English. Keep quoted dialogue, narration, and lyrics in the user's chosen spoken language; never translate those lines into English unless English was selected. English production instructions do not imply English speech
- In each video prompt that includes speech or singing, explicitly state the selected spoken language and quote the actual lines in that language. Preserve this choice across shots, rewrites, and retries. Example: `Dialogue in Spanish: "Papá, quiero ayudarlo."`
- Preserve hard constraints from reference analysis, including a locked visual style on long-form jobs
- GPT Image 2: photographic/art-direction detail, not a caption dump
- Seedance 2.0 / 2.5 / Wan 3.0: subject motion, camera move, pacing, and first/last-frame intent
- First-frame stills for a storyboard shot: opening composition, identity from the character three-view, locked visual style, no motion language
- Image-to-video: motion that starts from that first frame
- Reference-to-video: say how each still or clip is used (identity, product, style, motion, first-frame composition)
- Video edit (reference-to-video): name the source clip as the shot to keep, then the change (replace this person with Image1, restyle, swap the object). Do not rewrite it as a brand-new scene unless they asked to.
- Do not invent reference URLs
