# Cowart Workflow Reference

## Start And Check

Start Cowart for a project:

```bash
scripts/start-canvas.sh /absolute/path/to/project
```

Check the service:

```bash
curl -I http://127.0.0.1:43217/
```

`HTTP/1.1 200 OK` means the canvas service is reachable.

The start script checks `COWART_PORT` first, then tries the next ports. It prints the actual URL. Use that URL for browser navigation and script calls.

## Insert A Project Image

Preview without writing:

```bash
node scripts/insert-image.mjs \
  --image /absolute/path/to/image.png \
  --project-dir /absolute/path/to/project \
  --canvas-url http://127.0.0.1:43217 \
  --anchor first-image \
  --dry-run
```

Insert beside the selected shape:

```bash
node scripts/insert-image.mjs \
  --image /absolute/path/to/image.png \
  --project-dir /absolute/path/to/project \
  --canvas-url http://127.0.0.1:43217 \
  --anchor selected \
  --placement right \
  --margin 40
```

Insert an annotation-generated revision:

```bash
node scripts/insert-image.mjs \
  --image /absolute/path/to/revision.png \
  --project-dir /absolute/path/to/project \
  --canvas-url http://127.0.0.1:43217 \
  --anchor first-image \
  --placement right \
  --meta-json '{"cowartGeneratedFromAnnotationEdit":true}'
```

## Canvas API

Read the current canvas:

```bash
curl -s http://127.0.0.1:43217/api/canvas
```

Save supports both forms:

```json
{
  "schema": {},
  "store": {}
}
```

```json
{
  "snapshot": {
    "schema": {},
    "store": {}
  }
}
```

Prefer `scripts/insert-image.mjs` for image insertion instead of hand-writing tldraw records.

## Troubleshooting

- **Browser says unable to load:** Check `curl -I <url>`. If it does not return `200 OK`, the service is not running.
- **`listen EPERM`:** The sandbox blocked local port listening. Request permission to start the local service outside the sandbox.
- **Wrong port:** Use the URL printed by `scripts/start-canvas.sh`.
- **Image inserted over existing marks:** Re-run with `--dry-run`, then use a different anchor or larger `--margin`.
- **No anchor selected:** Use `--anchor first-image` to place beside the largest image on the current page.
