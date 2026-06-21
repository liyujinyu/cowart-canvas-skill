---
name: cowart-canvas-workflow
description: Open and operate a bundled Cowart/tldraw local canvas for Codex projects. Use when the user asks to open a Cowart canvas, use an infinite visual canvas, insert generated images into a project canvas, preserve before/after image revisions, or apply Cowart annotation screenshots by generating clean revised images beside originals.
---

# Cowart Canvas Workflow

## Core Rules

- Use the active Codex workspace as the project directory unless the user gives another directory.
- Save Cowart data in `<projectDir>/canvas/`; do not save user canvas data inside the skill folder.
- Never delete or move the original image or annotation marks when creating a revised image.
- For annotation edits, use the user-provided screenshot as the edit brief. Do not infer edit intent by scanning unrelated canvas content.
- After generating or editing images, keep final project-bound images in the project, then insert or paste them into Cowart.

## Open Canvas

Run the bundled service:

```bash
<skill-dir>/scripts/start-canvas.sh /absolute/path/to/project
```

Open the printed `Cowart canvas:` URL in the Codex in-app browser. Default URL is:

```text
http://127.0.0.1:43217/
```

If the script prints a different port, use that exact URL. If startup fails with `listen EPERM`, request permission to run the local service outside the sandbox.

## Insert Image

Use the bundled insert script for project-local images:

```bash
node <skill-dir>/scripts/insert-image.mjs \
  --image /absolute/path/to/image.png \
  --project-dir /absolute/path/to/project \
  --canvas-url http://127.0.0.1:43217
```

Useful options:

- `--anchor selected`: place beside the selected shape.
- `--anchor first-image`: place beside the largest image on the current page.
- `--placement right`: default before/after layout.
- `--dry-run`: calculate position without writing files or canvas state.
- `--meta-json '{"cowartGeneratedFromAnnotationEdit":true}'`: add metadata for generated revisions.

The script copies the image into `canvas/pages/<page-id>/assets/`, creates a tldraw image asset and shape, and saves through `/api/canvas`.

## Annotation Edit Flow

1. Read the supplied Cowart screenshot.
2. Extract visible edit notes, arrows, and target regions from that screenshot.
3. Generate a clean revised bitmap without annotation arrows, labels, selection handles, or UI chrome.
4. Save the bitmap in the project with a versioned filename.
5. Insert the revision beside the original image with `scripts/insert-image.mjs`.
6. Verify that the original image and annotations are still visible.

## Extra Reference

Read `references/cowart-workflow.md` when you need command examples, API details, or troubleshooting.
