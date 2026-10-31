import { load } from 'js-yaml'

export function parseProfileYaml(text: string): Record<string, unknown> {
  const config: unknown = load(text)
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new Error('Expected a Clash YAML configuration')
  }
  const mapping = config as Record<string, unknown>
  const providers = mapping['proxy-providers']
  if (
    !Array.isArray(mapping.proxies) &&
    !(
      typeof providers === 'object' &&
      providers !== null &&
      !Array.isArray(providers)
    )
  ) {
    throw new Error('The configuration must contain proxies or proxy-providers')
  }
  return mapping
}

export function isProfileYaml(text: string): boolean {
  return /(?:^|\n)\s*(?:proxies|proxy-providers)\s*:/u.test(text.trimStart())
}
