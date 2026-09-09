# Single generator

Use this skill when the user invokes a generator for a standalone image, edit, cutout, layer split, or single video clip, especially through an explicit model name or @[Name](model:id). Follow model-planning for exact model selection and schema validation. For a long film, storyboard, or multi-shot production, use long-form-video instead; do not add a second set of standalone checkpoints to its intermediate generations.

## Check the brief before generation

Read the selected tool's input schema and reuse the user's instructions, previous answers, and designated session media. An @ mention selects the model and task; it does not specify a subject, visual style, or output settings.

Resolve missing required inputs and meaningful creative/output choices with **ask_user** before calling a generation tool. This checkpoint also applies with Automatic generation confirmation. A spending confirmation or _uncertain_fields is not a substitute for answering these questions.

- **Creative direction:** if the request is only a model mention, ask what to create. If it is vague (such as “a cat”, “make a nice image”, or “animate this”), offer a few concrete directions grounded in the supplied subject or reference. Combine subject, setting, composition, and style into coherent proposals when that avoids several tiny questions. Do not silently turn your proposal into the user's intent.
- **Image settings:** resolve aspect ratio and resolution/quality when exposed by the selected schema and not already supplied or clearly implied by the intended use. A phone wallpaper can establish orientation; it does not establish an exact resolution. Offer documented defaults as recommendations, not as already confirmed answers. Do not ask for a style when a detailed prompt or explicitly designated style reference already settles it.
- **Video settings:** resolve the intended action/motion, clip duration, supported resolution, ratio when configurable, and sound when supported. Offer only settings legal for the selected model and input mode. If dialogue, narration, or singing is requested, resolve the spoken/lyric language unless already specified; chat language and an audio flag do not resolve it. Do not ask about speech for silent or instrumental-only clips.
- **Edits and utility tasks:** identify the source and what to change, keep, remove, or separate. A clear “remove this image's background” needs no visual-style questionnaire. Ask which subject/region only when the target is ambiguous. Reuse compatible media only when its intended role is clear.
- **Other parameters:** ask for required values without usable defaults. Omit optional technical controls such as seeds or negative prompts unless relevant to the user's request. Do not require users to fill every schema field.

A schema default alone does not settle a missing creative choice or the image/video settings above. A single legal value needs no question. Explicit delegation (“you decide”, “use defaults”, “surprise me”) settles the choices it covers: state the chosen direction/settings briefly and proceed using legal values. A complete brief proceeds directly without an extra approval card.

## Image Text Editor

For `image-text-editor`, request an upload if no source exists. Call `model_image_text_editor` to use the LLM to identify every visible text line and its approximate location in words. Do not detect coordinates or call an OCR model. Open the inline editor with exactly one input per detected line. When multiple images are uploaded together, detect each one and show a single editor with thumbnail switching, keeping each image’s text edits separate. On submission the runtime creates exactly one job per changed image in one confirmation batch. Skip unchanged images; do not re-detect or re-submit the batch. A detection failure on one image must not discard the other images. The backend sends the full original image directly to GPT Image 2 with instructions such as "At the upper left, change X to Y". Return the complete generated output without cropping or local compositing. Use the existing confirmation policy. A cancellation stops this workflow.

## Image Layer Splitter: resolve unspecified layers

Check for an actual user-supplied source image FIRST. A bare tool mention without an image requires a short plain-chat upload request, then a pause. Do not call `ask_user` for `layer_selection_method` or `layer_split_plan` until the image is available. Never infer image contents from the tool mention or unrelated project assets.

When the user only mentions **Image Layer Splitter** (`image-layer-splitter`) and supplies an image, but neither this request nor prior context identifies the objects/regions to separate, first call **ask_user** to ask how they want to specify the layers. Do not choose objects from the image or call the splitting tool yet.

This also applies across messages: if the user mentions the tool first, you request an image, and their next message only uploads that image, the layer targets are still unspecified. Uploading supplies the source only. It does not authorize extracting all visible subjects. Show the method card next; a generation confirmation is not a substitute.

Call **ask_user** to render an interactive confirmation card with question id `layer_selection_method` and the question "How would you like to specify the layers to extract?" Include **Draw boxes** (`draw_boxes`) and **Describe the layers** (`describe_layers`) as the two concrete options, plus Other with `allow_custom: true`. Recommend drawing boxes for precise selection. Follow the existing user-language rule for card text. Do not ask this question in a plain chat message, print a markdown option list, or merely announce that a card will be shown: the **ask_user** tool call is required. Stop and wait for the card response before proceeding.

- If they choose boxes, the `layer_selection_method` card opens an inline image selection canvas inside the chat. The user draws 1–16 boxes and clicks Confirm regions. Do not redirect to another page or ask for coordinates in chat. The card preserves boxes per image and submits `imageSelections`, each containing `imageUrl` and `regions` in normalized 0–1000 coordinates. The server queues one job per confirmed image directly. Legacy single-image responses contain `imageUrl` and `regions`; use those exact values for `image_url` and `regions`. Do not invent, expand, or replace the selections. Continue through the existing confirmation policy after submission.
- For multiple source images, retain each confirmed `imageUrl` and its own `regions`. Once the requested images are confirmed, call the splitter once per image, preferably together in one generation batch. A later confirmation only replaces earlier boxes for the same image; it never replaces another image’s selection. Do not stop after processing only the last image.
- If they choose description, follow the description-plan confirmation below before splitting, including when their method answer also describes the desired layers.
- If they skip the method question, recommend boxes and request the target regions; skipping the method does not identify any layers. If they explicitly delegate the choice of layers, follow that delegation.
- If the user already supplied boxes, clearly described the target layers, or previously chose a selection method, reuse that information and do not ask this method question again.

### Description-plan confirmation

After **Describe the layers** is selected, inspect the supplied image and use any description already provided to propose concrete extraction targets. Call **ask_user** again with question id `layer_split_plan` to display an interactive confirmation card. Do not replace this card with a plain-text request for a description or start splitting immediately.

The card question should briefly identify the visible subjects by recognizable appearance or position, state which subjects would become separate layers, and ask the user to confirm the plan. Offer two or three distinct, image-specific plans when applicable, such as extracting each visible subject separately or extracting only a named/positioned subject. Include **Other** with `allow_custom: true` so the user can describe different targets. Put the plan that best matches their description first and recommend it; if they have not described targets yet, present the image-derived plan as a proposal, not as their established intent. Do not hard-code character names, counts, or cancellation history from an example. Offer background separation only if the selected tool actually supports it.

Stop after the **ask_user** call and wait for the card response. On selection, use the confirmed plan to identify regions and call the splitter. On Other, use the custom description and clarify only remaining ambiguity. An explicit skip delegates to the card's stated recommended plan; state that plan before proceeding. Reuse an already confirmed plan instead of showing the same card again. This plan card is separate from any generation confirmation.

## Confirmation cards

Batch related unresolved choices into one **ask_user** call, usually one to four questions, at most six. Prioritize creative direction and indispensable parameters; carry any remaining necessary questions into the next card.

- Use stable question ids such as `creative_direction`, `aspect_ratio`, `resolution`, `duration`, and `sound_format`.
- Offer two or three concrete, distinct choices per question, or fewer if the schema permits fewer. Put the best fit first and set `recommended` to its option id. Briefly explain the effect of each choice. Adapt creative proposals to this request; do not reuse a generic menu for every subject.
- Include an **Other** option with `allow_custom: true` in every question. Accept custom intent, but validate custom parameter values against the selected schema before generating. If incompatible, explain the constraint and offer legal alternatives; do not silently clamp the user's choice.
- Use the user's preferred language for the introduction, recommendation, titles, questions, labels, and descriptions. Keep parameter keys and actual enum values in API format. Write production prompts in English while preserving requested on-image text and quoted speech in their chosen languages.
- Show choices through the card, not a duplicate markdown list. Include a short top-level recommendation explaining what you will choose if they skip.
- Stop until the card is answered or explicitly skipped. Do not mix **ask_user** with generation or `concat_videos` in the same turn. Silence, an unanswered card, and Automatic generation confirmation are not delegation.

When an indispensable image/video/audio file is missing, plainly request the upload or a usable URL and wait. A card may select among existing assets or clarify reference roles; it cannot upload a file. Skipping cannot supply a missing asset. Do not generate a prerequisite or replace the selected model/task without authorization.

## Continue after answers

Merge answers with the existing brief. Preserve the exact selected model, supplied parameters, and reference roles. Do not ask the same question again; a skip delegates only the skipped choices. Resolve only newly introduced ambiguities or invalid combinations.

Once the brief is ready, compile the prompt and call the selected registered model_* tool with its actual schema fields, legal parameter combinations, available media, and a localized _name. Follow the existing confirmation policy. Do not add storyboard approval, character sheets, or other long-form stages to a standalone request. Present successful outputs; explain failures without claiming success or repeatedly retrying unchanged requests.

## Examples of the decision boundary

- **@Text to Image + “a cat”:** ask for a concrete direction (for example, a sunlit photographic pet portrait, a playful illustrated cat, or a cinematic night scene), plus unresolved supported ratio and resolution settings. Include Other in each question and wait before generating.
- **@Text to Image only:** ask for the desired content with a few suggested starting points and Other; there is no subject yet. Suggestions are proposals, not inferred requirements.
- **Detailed prompt + supported ratio and resolution:** generate directly; do not ask for style or reconfirm supplied settings.
- **@Text to Image + “a cat, you decide everything else”:** choose a coherent direction and documented output defaults, state them briefly, then generate.
- **@Image to Video without a source image:** request the actual image. Skipping creative questions does not unblock the required media input.
- **@Text to Video + “a 90-second multi-scene story”:** route to long-form-video using the chosen model's actual limits; do not shorten it into one standalone clip.
