import { dump, load } from 'js-yaml'

import fullTemplate from '@/assets/rules/shellcrash-full.yaml?raw'
import nanoTemplate from '@/assets/rules/shellcrash-nano.yaml?raw'

import { parseYamlSafe } from './yaml'

export const aggregateTemplates = {
  nano: nanoTemplate,
  full: fullTemplate,
}

export interface AggregateSettings {
  version: 1
  sources: string[]
  templateId: 'nano' | 'full' | 'custom'
  template: string
  other: string
}

interface AggregateSourceBase {
  uid: string
  name: string
}

export type AggregateSource = AggregateSourceBase &
  (
    | { url: string; userAgent?: string; intervalMinutes?: number }
    | { file: string }
  )

type YamlMapping = Record<string, unknown>

const isMapping = (value: unknown): value is YamlMapping =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseMapping(text: string): YamlMapping {
  if (
    text
      .split(/\r?\n/u)
      .every((line) => !line.trim() || line.trimStart().startsWith('#'))
  )
    return {}
  const value: unknown = load(text)
  if (value == null) return {}
  if (!isMapping(value)) throw new Error('Expected a YAML mapping')
  return value
}

export function readAggregateSettings(text: string): AggregateSettings | null {
  const config = parseYamlSafe(text)
  const value = isMapping(config) ? config['x-verge-aggregate'] : undefined
  if (!isMapping(value) || value.version !== 1) return null
  if (
    !Array.isArray(value.sources) ||
    !value.sources.every((source) => typeof source === 'string') ||
    !['nano', 'full', 'custom'].includes(String(value.templateId)) ||
    typeof value.template !== 'string' ||
    typeof value.other !== 'string'
  ) {
    throw new Error('Invalid aggregate profile settings')
  }
  return value as unknown as AggregateSettings
}

function mergeMapping(base: YamlMapping, overlay: YamlMapping): YamlMapping {
  const result = { ...base }
  for (const [key, value] of Object.entries(overlay)) {
    const previous = result[key]
    result[key] =
      isMapping(previous) && isMapping(value)
        ? mergeMapping(previous, value)
        : value
  }
  return result
}

export function buildAggregateProfile(
  settings: AggregateSettings,
  sources: AggregateSource[],
): string {
  if (settings.sources.length === 0) {
    throw new Error('Select at least one subscription')
  }
  const selected = settings.sources.map((uid) => {
    const source = sources.find((item) => item.uid === uid)
    if (!source) throw new Error(`Subscription is no longer available: ${uid}`)
    return source
  })
  const groupNames = selected.map((source) => `${source.name} [${source.uid}]`)
  const tags = groupNames.map((name) => JSON.stringify(name)).join(', ')
  const template = parseMapping(
    settings.template.replaceAll('{providers_tags}', tags),
  )
  if (
    !Array.isArray(template['proxy-groups']) ||
    !Array.isArray(template.rules)
  ) {
    throw new Error('The rule template must contain proxy-groups and rules')
  }

  const providers: YamlMapping = {}
  const groups = selected.map((source, index) => {
    const providerName = `subscription-${source.uid}`
    providers[providerName] = {
      ...('url' in source
        ? {
            type: 'http',
            url: source.url,
            interval: Math.max(source.intervalMinutes || 1440, 1) * 60,
            header: { 'User-Agent': [source.userAgent || 'clash.meta'] },
          }
        : { type: 'file', path: `./profiles/${source.file}` }),
      'health-check': {
        enable: true,
        lazy: true,
        url: 'https://www.gstatic.com/generate_204',
        interval: 300,
      },
      override: { 'additional-prefix': `${groupNames[index]} · ` },
    }
    return {
      name: groupNames[index],
      type: 'url-test',
      use: [providerName],
      url: 'https://www.gstatic.com/generate_204',
      interval: 300,
      tolerance: 100,
    }
  })

  const reservedNames = new Set([
    'DIRECT',
    'REJECT',
    'REJECT-DROP',
    'PASS',
    'COMPATIBLE',
    'GLOBAL',
    ...groupNames,
    ...template['proxy-groups'].map((group: YamlMapping) => group.name),
  ])
  const aliases = selected.flatMap((source, index) => {
    if (
      reservedNames.has(source.name) ||
      selected.filter((item) => item.name === source.name).length !== 1
    )
      return []
    return [{ name: source.name, type: 'select', proxies: [groupNames[index]] }]
  })

  const config = mergeMapping(
    {
      ...template,
      'proxy-providers': {
        ...(template['proxy-providers'] as YamlMapping),
        ...providers,
      },
      'proxy-groups': [...template['proxy-groups'], ...aliases, ...groups],
    },
    parseMapping(settings.other),
  )
  config['x-verge-aggregate'] = settings
  return dump(config, { lineWidth: -1, noRefs: true })
}
