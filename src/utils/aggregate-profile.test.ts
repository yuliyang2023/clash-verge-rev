import { load } from 'js-yaml'
import { describe, expect, test } from 'vitest'

import {
  aggregateTemplates,
  buildAggregateProfile,
  readAggregateSettings,
  type AggregateSettings,
} from './aggregate-profile'
import { isProfileYaml, parseProfileYaml } from './profile-yaml'

const sources = [
  {
    uid: 'R1',
    name: 'Airport: "A", #1',
    url: 'https://example.com/a?token=a',
    userAgent: 'custom-agent',
    intervalMinutes: 60,
  },
  { uid: 'R2', name: 'Airport: "A", #1', url: 'https://example.com/b?token=b' },
]

const settings: AggregateSettings = {
  version: 1,
  sources: ['R1', 'R2'],
  templateId: 'nano',
  template: aggregateTemplates.nano,
  other: '',
}

describe('aggregate subscription configuration', () => {
  test.each(['nano', 'full'] as const)(
    '%s template resolves policies for multiple providers',
    (templateId) => {
      const selected = {
        ...settings,
        templateId,
        template: aggregateTemplates[templateId],
      }
      const text = buildAggregateProfile(selected, sources)
      const config = load(text) as Record<string, any>
      const groups = config['proxy-groups'] as {
        name: string
        proxies?: string[]
        use?: string[]
      }[]
      const groupNames = new Set([
        'DIRECT',
        'REJECT',
        'PASS',
        ...groups.map((group) => group.name),
      ])
      const providers = config['proxy-providers']

      expect(Object.keys(providers)).toEqual([
        'subscription-R1',
        'subscription-R2',
      ])
      expect(providers['subscription-R1'].url).toBe(sources[0].url)
      expect(providers['subscription-R1'].header['User-Agent']).toEqual([
        'custom-agent',
      ])
      expect(providers['subscription-R1'].interval).toBe(3600)
      expect(providers['subscription-R1'].override).not.toEqual(
        providers['subscription-R2'].override,
      )
      expect(groups.slice(-2).map((group) => group.use)).toEqual([
        ['subscription-R1'],
        ['subscription-R2'],
      ])
      for (const group of groups) {
        for (const policy of group.proxies ?? [])
          expect(groupNames.has(policy)).toBe(true)
      }
      for (const rule of config.rules as string[]) {
        const parts = rule.split(',')
        const policy =
          parts.at(-1) === 'no-resolve' ? parts.at(-2) : parts.at(-1)
        expect(groupNames.has(policy!)).toBe(true)
        if (parts[0] === 'RULE-SET')
          expect(config['rule-providers'][parts[1]]).toBeDefined()
      }
      expect(readAggregateSettings(text)).toEqual(selected)
    },
  )

  test('custom YAML retains generated providers and supports anchors and list replacement', () => {
    const other =
      'dns:\n  nameserver: &dns [1.1.1.1]\n  fallback: *dns\nrules: ["MATCH,DIRECT"]\nlisteners: []\nproxy-providers:\n  extra: {type: inline, payload: []}\n'
    const config = load(
      buildAggregateProfile({ ...settings, other }, sources),
    ) as Record<string, any>
    expect(config.dns.nameserver).toEqual(config.dns.fallback)
    expect(config.rules).toEqual(['MATCH,DIRECT'])
    expect(config['proxy-providers']['subscription-R1']).toBeDefined()
    expect(config['proxy-providers'].extra.type).toBe('inline')
    expect(config.listeners).toEqual([])
    expect(
      readAggregateSettings(
        buildAggregateProfile({ ...settings, other }, sources),
      )?.other,
    ).toBe(other)
  })

  test('rejects missing subscriptions and malformed custom YAML without changing a profile', () => {
    expect(() => buildAggregateProfile(settings, sources.slice(0, 1))).toThrow(
      'R2',
    )
    expect(() =>
      buildAggregateProfile({ ...settings, other: 'rules: [' }, sources),
    ).toThrow()
    expect(() =>
      buildAggregateProfile({ ...settings, other: '- not a mapping' }, sources),
    ).toThrow()
    expect(readAggregateSettings('proxies: []')).toBeNull()
  })

  test('imports a complete SOCKS5 YAML profile and aggregates only its nodes through a file provider', () => {
    const yaml = `# Local SOCKS5 configuration
proxies:
  - name: cmss-win7
    type: socks5
    server: 192.168.1.14
    port: 8385
    udp: true
proxy-groups:
  - name: PROXY
    type: select
    proxies: [cmss-win7]
rule-providers:
rules:
  - DOMAIN-SUFFIX,cmss.com,PROXY
  - MATCH,DIRECT
dns:
  enable: true
  ipv6: true
  nameserver: [223.5.5.5, "2400:3200::1"]
`
    expect(isProfileYaml(yaml)).toBe(true)
    const imported = parseProfileYaml(yaml)
    expect(imported['rule-providers']).toBeNull()
    expect(imported.rules).toContain('DOMAIN-SUFFIX,cmss.com,PROXY')
    expect(imported.dns).toMatchObject({ enable: true, ipv6: true })
    const config = load(
      buildAggregateProfile({ ...settings, sources: ['R1', 'L1'] }, [
        sources[0],
        { uid: 'L1', name: '中文配置', file: '中文配置.yaml' },
      ]),
    ) as Record<string, any>
    expect(config['proxy-providers']['subscription-R1'].type).toBe('http')
    expect(config['proxy-providers']['subscription-L1']).toMatchObject({
      type: 'file',
      path: './profiles/中文配置.yaml',
    })
    expect(config['proxy-providers']['subscription-L1'].url).toBeUndefined()
    expect(config.rules).not.toContain('DOMAIN-SUFFIX,cmss.com,PROXY')
    expect(config.dns).toBeUndefined()
  })

  test('distinguishes pasted YAML from a URL and rejects invalid imports', () => {
    expect(isProfileYaml('https://example.com/subscription')).toBe(false)
    expect(isProfileYaml('\uFEFFproxies: []')).toBe(true)
    expect(() => parseProfileYaml('proxies: [')).toThrow()
    expect(() => parseProfileYaml('- not a configuration')).toThrow()
    expect(() => parseProfileYaml('rules: ["MATCH,DIRECT"]')).toThrow()
  })

  test('custom rules can reference an unambiguous source name without its profile ID', () => {
    const config = load(
      buildAggregateProfile(
        {
          ...settings,
          sources: ['L1'],
          other:
            'rules: ["DOMAIN-SUFFIX,example.internal,office", "MATCH,DIRECT"]',
        },
        [{ uid: 'L1', name: 'office', file: 'L1.yaml' }],
      ),
    ) as Record<string, any>
    expect(config['proxy-groups']).toContainEqual({
      name: 'office',
      type: 'select',
      proxies: ['office [L1]'],
    })
    expect(config['proxy-groups']).toContainEqual(
      expect.objectContaining({
        name: 'office [L1]',
        use: ['subscription-L1'],
      }),
    )
    expect(config.rules[0]).toBe('DOMAIN-SUFFIX,example.internal,office')

    const collisions = load(buildAggregateProfile(settings, sources)) as Record<
      string,
      any
    >
    expect(
      collisions['proxy-groups'].some(
        (group: { name: string }) => group.name === sources[0].name,
      ),
    ).toBe(false)
  })
})
