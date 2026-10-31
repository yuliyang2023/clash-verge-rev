import {
  Alert,
  Checkbox,
  FormControl,
  FormHelperText,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog } from '@/components/base'
import { createProfile, patchProfile, saveProfileFile } from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { showNotice } from '@/services/notice-service'
import {
  aggregateTemplates,
  buildAggregateProfile,
  type AggregateSettings,
} from '@/utils/aggregate-profile'

import { FileInput } from './file-input'

interface Props {
  profiles: IProfileItem[]
  item?: IProfileItem
  settings?: AggregateSettings
  onClose: () => void
  onSaved: () => Promise<void>
}

export const AggregateProfileViewer = ({
  profiles,
  item,
  settings,
  onClose,
  onSaved,
}: Props) => {
  const { t } = useTranslation()
  const [name, setName] = useState(
    () => item?.name ?? t('profiles.aggregate.defaultName'),
  )
  const [value, setValue] = useState<AggregateSettings>(
    settings ?? {
      version: 1,
      sources: [],
      templateId: 'nano',
      template: aggregateTemplates.nano,
      other: '',
    },
  )
  const [saving, setSaving] = useState(false)
  const sources = profiles.filter(
    (profile) => profile.type === 'remote' && profile.url,
  )
  const missing = value.sources.filter(
    (uid) => !sources.some((source) => source.uid === uid),
  )

  const handleSave = useLockFn(async () => {
    setSaving(true)
    try {
      const data = buildAggregateProfile(
        value,
        sources.map((source) => ({
          uid: source.uid!,
          name: source.name || source.uid!,
          url: source.url!,
          userAgent: source.option?.user_agent ?? undefined,
          intervalMinutes: source.option?.update_interval ?? undefined,
        })),
      )
      if (item?.uid) {
        const uid = item.uid
        const saved = await mutate(() => saveProfileFile(uid, data), {
          id: `save-profile-file:${uid}`,
          errorNotice: false,
        })
        if (!saved.value) return
        await mutate(() => patchProfile(uid, { name: name.trim() }), {
          id: `patch-profile:${uid}`,
          errorNotice: false,
        })
      } else {
        await mutate(
          () => createProfile({ type: 'local', name: name.trim() }, data),
          { id: 'create-profile', errorNotice: false },
        )
      }
      await onSaved()
      onClose()
    } catch (error) {
      showNotice.error('profiles.aggregate.saveFailed', error)
    } finally {
      setSaving(false)
    }
  })

  return (
    <BaseDialog
      open
      title={t('profiles.aggregate.title')}
      contentSx={{ width: 520, maxWidth: '100%' }}
      okBtn={t('shared.actions.save')}
      cancelBtn={t('shared.actions.cancel')}
      disableOk={
        !name.trim() || value.sources.length === 0 || missing.length > 0
      }
      loading={saving}
      onOk={handleSave}
      onClose={saving ? undefined : onClose}
      onCancel={saving ? undefined : onClose}
      disableCancel={saving}
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Alert severity="info">{t('profiles.aggregate.description')}</Alert>
        <TextField
          size="small"
          label={t('shared.labels.name')}
          value={name}
          disabled={saving}
          onChange={(event) => setName(event.target.value)}
        />
        <FormControl size="small" disabled={saving} error={missing.length > 0}>
          <InputLabel id="aggregate-sources-label">
            {t('profiles.aggregate.sources')}
          </InputLabel>
          <Select
            multiple
            labelId="aggregate-sources-label"
            label={t('profiles.aggregate.sources')}
            value={value.sources}
            onChange={(event) => {
              const selected = event.target.value
              setValue((current) => ({
                ...current,
                sources:
                  typeof selected === 'string' ? selected.split(',') : selected,
              }))
            }}
            renderValue={(selected) =>
              selected
                .map(
                  (uid) =>
                    sources.find((source) => source.uid === uid)?.name || uid,
                )
                .join(', ')
            }
          >
            {sources.map((source) => (
              <MenuItem key={source.uid} value={source.uid!}>
                <Checkbox checked={value.sources.includes(source.uid!)} />
                <ListItemText primary={source.name || source.uid} />
              </MenuItem>
            ))}
            {missing.map((uid) => (
              <MenuItem key={uid} value={uid}>
                <Checkbox checked />
                <ListItemText
                  primary={t('profiles.aggregate.missingSource', { uid })}
                />
              </MenuItem>
            ))}
          </Select>
          <FormHelperText>
            {missing.length > 0
              ? t('profiles.aggregate.removeMissing')
              : t('profiles.aggregate.sourcesHint')}
          </FormHelperText>
        </FormControl>
        <FormControl size="small" disabled={saving}>
          <InputLabel id="aggregate-template-label">
            {t('profiles.aggregate.template')}
          </InputLabel>
          <Select
            labelId="aggregate-template-label"
            label={t('profiles.aggregate.template')}
            value={value.templateId}
            onChange={(event) => {
              const templateId = event.target
                .value as AggregateSettings['templateId']
              setValue((current) => ({
                ...current,
                templateId,
                template:
                  templateId === 'custom'
                    ? current.template
                    : aggregateTemplates[templateId],
              }))
            }}
          >
            <MenuItem value="nano">{t('profiles.aggregate.nano')}</MenuItem>
            <MenuItem value="full">{t('profiles.aggregate.full')}</MenuItem>
            <MenuItem value="custom">{t('profiles.aggregate.custom')}</MenuItem>
          </Select>
        </FormControl>
        {value.templateId === 'custom' && (
          <Stack>
            <TextField
              multiline
              minRows={4}
              maxRows={10}
              label={t('profiles.aggregate.template')}
              value={value.template}
              disabled={saving}
              onChange={(event) =>
                setValue((current) => ({
                  ...current,
                  template: event.target.value,
                }))
              }
            />
            <FileInput
              onChange={(_file, text) =>
                setValue((current) => ({ ...current, template: text }))
              }
            />
          </Stack>
        )}
        <Stack>
          <TextField
            multiline
            minRows={5}
            maxRows={12}
            label={t('profiles.aggregate.other')}
            helperText={t('profiles.aggregate.otherHint')}
            value={value.other}
            disabled={saving}
            onChange={(event) =>
              setValue((current) => ({ ...current, other: event.target.value }))
            }
          />
          <FileInput
            onChange={(_file, text) =>
              setValue((current) => ({ ...current, other: text }))
            }
          />
        </Stack>
      </Stack>
    </BaseDialog>
  )
}
