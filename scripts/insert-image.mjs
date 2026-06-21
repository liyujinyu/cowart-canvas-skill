#!/usr/bin/env node
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'

const pageIdPrefix = 'page:'

function usage() {
  return `
Usage:
  node scripts/insert-image.mjs --image /abs/path/image.png --project-dir /abs/path/project [options]

Options:
  --canvas-url <url>       Cowart URL. Default: http://127.0.0.1:43217
  --anchor <mode|shapeId>  selected, first-image, none, or shape:<id>. Default: selected
  --placement <side>       right or below. Default: right
  --margin <number>        Canvas units between shapes. Default: 40
  --file-name <name>       Saved page asset name. Default: source name with a timestamp
  --alt <text>             Image alt text.
  --meta-json <json>       Extra shape meta JSON.
  --dry-run                Print the planned insert without writing files or canvas state.
`.trim()
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`)
    const name = key.slice(2)
    if (name === 'help' || name === 'dry-run') {
      args[name] = true
      continue
    }
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`)
    args[name] = value
    i += 1
  }
  return args
}

function pageDirName(pageId) {
  return encodeURIComponent(String(pageId).replace(pageIdPrefix, ''))
}

function isSafeChildPath(parent, child) {
  const pathToChild = relative(parent, child)
  return pathToChild && !pathToChild.startsWith('..') && !pathToChild.includes(`..${sep}`)
}

function mimeTypeForPath(filePath) {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  throw new Error(`Unsupported image extension: ${ext || '(none)'}`)
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16)
}

async function imageDimensions(filePath) {
  const buffer = await readFile(filePath)

  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { w: buffer.readUInt32BE(16), h: buffer.readUInt32BE(20) }
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = buffer[offset + 1]
      const length = buffer.readUInt16BE(offset + 2)
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { h: buffer.readUInt16BE(offset + 5), w: buffer.readUInt16BE(offset + 7) }
      }
      offset += 2 + length
    }
  }

  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buffer.toString('ascii', 12, 16)
    if (kind === 'VP8X') return { w: readUInt24LE(buffer, 24) + 1, h: readUInt24LE(buffer, 27) + 1 }
    if (kind === 'VP8 ' && buffer.length >= 30) return { w: buffer.readUInt16LE(26) & 0x3fff, h: buffer.readUInt16LE(28) & 0x3fff }
    if (kind === 'VP8L' && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21)
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }
    }
  }

  throw new Error('Could not read image dimensions. Use PNG, JPEG, or WebP.')
}

async function readJsonUrl(url) {
  const response = await fetch(url)
  const text = await response.text()
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text}`)
  return JSON.parse(text)
}

async function writeSnapshot(canvasUrl, snapshot) {
  const response = await fetch(`${canvasUrl}/api/canvas`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(snapshot)
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`/api/canvas returned ${response.status}: ${text}`)
  return JSON.parse(text)
}

function pageRecords(snapshot) {
  return Object.values(snapshot.store)
    .filter((record) => record?.typeName === 'page')
    .sort((a, b) => String(a.index ?? '').localeCompare(String(b.index ?? '')))
}

function shapeRecords(snapshot, pageId) {
  return Object.values(snapshot.store).filter((record) => record?.typeName === 'shape' && record.parentId === pageId)
}

function roughBounds(shape) {
  if (!shape || shape.typeName !== 'shape') return null
  const x = Number(shape.x ?? 0)
  const y = Number(shape.y ?? 0)
  const props = shape.props ?? {}
  if (shape.type === 'image' || shape.type === 'geo' || shape.type === 'frame') {
    return { x, y, w: Number(props.w ?? 1), h: Number(props.h ?? 1) }
  }
  if (shape.type === 'text') return { x, y, w: Number(props.w ?? 240), h: Number(props.h ?? 80) }
  if (shape.type === 'arrow') {
    const start = props.start ?? { x: 0, y: 0 }
    const end = props.end ?? { x: 0, y: 0 }
    const minX = Math.min(0, start.x ?? 0, end.x ?? 0)
    const minY = Math.min(0, start.y ?? 0, end.y ?? 0)
    const maxX = Math.max(0, start.x ?? 0, end.x ?? 0)
    const maxY = Math.max(0, start.y ?? 0, end.y ?? 0)
    return { x: x + minX, y: y + minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
  }
  return { x, y, w: Number(props.w ?? 120), h: Number(props.h ?? 120) }
}

function intersects(a, b, margin) {
  return !(
    a.x + a.w + margin <= b.x ||
    b.x + b.w + margin <= a.x ||
    a.y + a.h + margin <= b.y ||
    b.y + b.h + margin <= a.y
  )
}

function nextIndex(snapshot, pageId) {
  const indices = shapeRecords(snapshot, pageId).map((shape) => String(shape.index ?? 'a1'))
  let max = 0
  for (const index of indices) {
    const match = /^a(\d+)/.exec(index)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `a${max + 1}`
}

async function selectedShapeIds(canvasUrl) {
  try {
    const result = await readJsonUrl(`${canvasUrl}/api/selection`)
    return result.selection?.selectedShapes?.map((shape) => shape.id).filter(Boolean) ?? []
  } catch {
    return []
  }
}

function findAnchor(snapshot, pageId, anchorMode, selectedIds) {
  if (anchorMode?.startsWith('shape:')) return snapshot.store[anchorMode]

  if (anchorMode === 'selected') {
    for (const id of selectedIds) {
      const shape = snapshot.store[id]
      if (shape?.typeName === 'shape' && shape.parentId === pageId) return shape
    }
  }

  if (anchorMode === 'none') return null

  return shapeRecords(snapshot, pageId)
    .filter((shape) => shape.type === 'image')
    .sort((a, b) => Number(b.props?.w ?? 0) * Number(b.props?.h ?? 0) - Number(a.props?.w ?? 0) * Number(a.props?.h ?? 0))[0] ?? null
}

function placementFor(anchor, imageSize, existingBounds, placement, margin) {
  if (!anchor) return { x: 0, y: 0 }

  const anchorBounds = roughBounds(anchor)
  const candidate = {
    x: placement === 'below' ? anchorBounds.x : anchorBounds.x + anchorBounds.w + margin,
    y: placement === 'below' ? anchorBounds.y + anchorBounds.h + margin : anchorBounds.y,
    w: imageSize.w,
    h: imageSize.h
  }

  const stepX = imageSize.w + margin
  const stepY = imageSize.h + margin
  let guard = 0
  while (existingBounds.some((bounds) => intersects(candidate, bounds, margin)) && guard < 100) {
    if (placement === 'below') candidate.y += stepY
    else candidate.x += stepX
    guard += 1
  }

  return { x: candidate.x, y: candidate.y }
}

function cleanFileName(name) {
  return name.replace(/[^\w.\-\u4e00-\u9fa5]+/g, '-')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }

  const imagePath = args.image ? resolve(args.image) : null
  const projectDir = args['project-dir'] ? resolve(args['project-dir']) : resolve(process.env.COWART_PROJECT_DIR ?? process.cwd())
  const canvasDir = resolve(process.env.COWART_CANVAS_DIR ?? join(projectDir, 'canvas'))
  const canvasUrl = (args['canvas-url'] ?? process.env.COWART_URL ?? 'http://127.0.0.1:43217').replace(/\/$/, '')
  const anchorMode = args.anchor ?? 'selected'
  const placement = args.placement ?? 'right'
  const margin = Number(args.margin ?? 40)
  const altText = args.alt ?? 'Cowart inserted image'
  const extraMeta = args['meta-json'] ? JSON.parse(args['meta-json']) : {}
  const dryRun = args['dry-run'] === true

  if (!imagePath) throw new Error(`Missing --image.\n${usage()}`)
  if (!Number.isFinite(margin) || margin < 0) throw new Error('--margin must be a non-negative number.')
  if (!['right', 'below'].includes(placement)) throw new Error('--placement must be right or below.')
  if (!isSafeChildPath(resolve('/'), imagePath)) throw new Error('Image path must be absolute or resolvable.')

  const canvasPayload = await readJsonUrl(`${canvasUrl}/api/canvas`)
  const snapshot = canvasPayload.snapshot
  if (!snapshot?.store || !snapshot?.schema) {
    throw new Error('Cowart canvas is empty. Open the canvas once in the browser, then run this script again.')
  }

  const pages = pageRecords(snapshot)
  const firstPageId = pages[0]?.id
  if (!firstPageId) throw new Error('No page was found in the Cowart canvas.')

  const viewState = await readJsonUrl(`${canvasUrl}/api/view-state`).catch(() => null)
  const pageId = viewState?.viewState?.currentPageId && snapshot.store[viewState.viewState.currentPageId]
    ? viewState.viewState.currentPageId
    : firstPageId

  const selectedIds = await selectedShapeIds(canvasUrl)
  const anchor = findAnchor(snapshot, pageId, anchorMode, selectedIds)
  const sourceDimensions = await imageDimensions(imagePath)
  const displaySize = anchor?.props?.w && anchor?.props?.h
    ? { w: Number(anchor.props.w), h: Number(anchor.props.h) }
    : sourceDimensions
  const existingBounds = shapeRecords(snapshot, pageId).map(roughBounds).filter(Boolean)
  const position = placementFor(anchor, displaySize, existingBounds, placement, margin)

  const pageAssetsDir = join(canvasDir, 'pages', pageDirName(pageId), 'assets')

  const base = cleanFileName(args['file-name'] ?? `${Date.now()}-${basename(imagePath)}`)
  const savedAssetPath = join(pageAssetsDir, base)
  if (!isSafeChildPath(pageAssetsDir, savedAssetPath)) throw new Error('Resolved asset path is outside the page assets directory.')
  const fileStat = await stat(imagePath)

  const assetId = `asset:${randomBytes(8).toString('hex')}`
  const shapeId = `shape:${randomBytes(8).toString('hex')}`
  const assetRecord = {
    id: assetId,
    type: 'image',
    typeName: 'asset',
    props: {
      name: base,
      src: `/page-assets/${pageDirName(pageId)}/${encodeURIComponent(base)}`,
      w: sourceDimensions.w,
      h: sourceDimensions.h,
      fileSize: fileStat.size,
      mimeType: mimeTypeForPath(imagePath),
      isAnimated: false
    },
    meta: {}
  }

  const shapeRecord = {
    x: position.x,
    y: position.y,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    meta: {
      cowartInsertedByScript: true,
      cowartSourceImagePath: imagePath,
      ...(anchor ? { cowartAnchorShapeId: anchor.id } : {}),
      ...extraMeta
    },
    id: shapeId,
    type: 'image',
    props: {
      w: displaySize.w,
      h: displaySize.h,
      assetId,
      playing: true,
      url: '',
      crop: null,
      flipX: false,
      flipY: false,
      altText
    },
    parentId: pageId,
    index: nextIndex(snapshot, pageId),
    typeName: 'shape'
  }

  if (!dryRun) {
    await mkdir(pageAssetsDir, { recursive: true })
    await copyFile(imagePath, savedAssetPath)
    snapshot.store[assetId] = assetRecord
    snapshot.store[shapeId] = shapeRecord
  }

  const saveResult = dryRun ? { dryRun: true } : await writeSnapshot(canvasUrl, snapshot)
  console.log(
    JSON.stringify(
      {
        ok: true,
        canvasUrl,
        pageId,
        assetId,
        shapeId,
        savedAssetPath,
        bounds: { ...position, ...displaySize },
        saveResult
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
