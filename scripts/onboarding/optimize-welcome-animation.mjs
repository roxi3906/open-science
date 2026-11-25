/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '../..')
const sourcePath = join(projectRoot, 'src/renderer/src/assets/onboarding/welcome.json')
const outputPath = join(projectRoot, 'src/renderer/src/assets/onboarding/welcome-optimized.json')
const iconDirectory = join(projectRoot, 'src/renderer/src/assets/onboarding/icons')

const positionTolerance = 0.75
const scalarTolerance = 0.5
const speedFactor = 0.9

const round = (value) => Number(value.toFixed(4))

const distanceToSegment = (point, start, end) => {
  const duration = end.time - start.time
  const ratio = duration === 0 ? 0 : (point.time - start.time) / duration
  const expected = start.value.map((value, index) => value + (end.value[index] - value) * ratio)
  return Math.hypot(...point.value.map((value, index) => value - expected[index]))
}

const simplifyIndices = (points, tolerance) => {
  const simplify = (items) => {
    if (items.length <= 2) return [items[0].index, items[items.length - 1].index]

    let largestDistance = 0
    let largestIndex = -1
    for (let index = 1; index < items.length - 1; index += 1) {
      const distance = distanceToSegment(items[index], items[0], items[items.length - 1])
      if (distance > largestDistance) {
        largestDistance = distance
        largestIndex = index
      }
    }

    if (largestDistance <= tolerance) return [items[0].index, items[items.length - 1].index]

    return simplify(items.slice(0, largestIndex + 1))
      .slice(0, -1)
      .concat(simplify(items.slice(largestIndex)))
  }

  return simplify(points).filter(
    (index, position, values) => position === 0 || index !== values[position - 1]
  )
}

const simplifyKeyframes = (keyframes, tolerance, kind) => {
  if (!Array.isArray(keyframes) || keyframes.length === 0 || typeof keyframes[0] !== 'object') {
    return keyframes
  }

  const points = keyframes.map((keyframe, index) => ({
    index,
    time: keyframe.t,
    value: kind === 'position' ? [keyframe.s[0], keyframe.s[1]] : [keyframe.s[0]]
  }))
  const indices = simplifyIndices(points, tolerance)

  return indices.map((index, position) => {
    const keyframe = keyframes[index]
    const nextKeyframe = keyframes[indices[position + 1]]
    return {
      ...keyframe,
      t: round(keyframe.t * speedFactor),
      e: nextKeyframe ? nextKeyframe.s : keyframe.s
    }
  })
}

const scaleLayerTime = (layer) => {
  for (const key of ['ip', 'op', 'st']) {
    if (typeof layer[key] === 'number') layer[key] = round(layer[key] * speedFactor)
  }

  for (const [property, kind, tolerance] of [
    ['o', 'scalar', scalarTolerance],
    ['p', 'position', positionTolerance],
    ['s', 'scalar', scalarTolerance]
  ]) {
    if (layer.ks?.[property]?.a === 1) {
      layer.ks[property].k = simplifyKeyframes(layer.ks[property].k, tolerance, kind)
    }
  }
}

const iconFileName = (assetId) => (assetId === 'agents-4' ? 'providers-5.svg' : `${assetId}.svg`)

const main = async () => {
  const animation = JSON.parse(await readFile(sourcePath, 'utf8'))
  animation.op = round(animation.op * speedFactor)

  await mkdir(iconDirectory, { recursive: true })
  const writtenIcons = new Set()
  for (const asset of animation.assets) {
    const shouldUseLogo = asset.id === 'center' || asset.id === 'agents-5'
    if (!shouldUseLogo && asset.p.startsWith('data:image/svg+xml;base64,')) {
      const fileName = iconFileName(asset.id)
      if (!writtenIcons.has(fileName)) {
        const encoded = asset.p.slice('data:image/svg+xml;base64,'.length)
        await writeFile(join(iconDirectory, fileName), Buffer.from(encoded, 'base64'))
        writtenIcons.add(fileName)
      }
      asset.p = fileName
    } else {
      asset.p = ''
    }
    asset.u = ''
    asset.e = 0
  }

  for (const layer of animation.layers) scaleLayerTime(layer)
  await writeFile(outputPath, JSON.stringify(animation))
  console.log(
    JSON.stringify({
      outputPath,
      iconDirectory,
      bytes: Buffer.byteLength(JSON.stringify(animation))
    })
  )
}

await main()
