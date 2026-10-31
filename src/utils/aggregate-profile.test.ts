import { load } from 'js-yaml'
import { describe, expect, test } from 'vitest'

import {
  aggregateTemplates,
  buildAggregateProfile,
  readAggregateSettings,
  type AggregateSettings,
} from './aggregate-profile'

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
})
