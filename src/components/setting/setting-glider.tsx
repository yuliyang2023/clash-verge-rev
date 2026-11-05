import { Box, Button, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getGliderStatus, startGlider, stopGlider } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

import { SettingList } from './mods/setting-comp'

const SettingGlider = () => {
  const { t } = useTranslation()
  const [listenPort, setListenPort] = useState(
    () => localStorage.getItem('glider.listenPort') || '1080',
  )
  const [targetIp, setTargetIp] = useState(
    () => localStorage.getItem('glider.targetIp') || '192.168.1.16',
  )
  const [targetPort, setTargetPort] = useState(
    () => localStorage.getItem('glider.targetPort') || '7890',
  )
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const refresh = () =>
      getGliderStatus().then(setRunning).catch(showNotice.error)
    void refresh()
    const timer = window.setInterval(refresh, 3000)
    return () => window.clearInterval(timer)
  }, [])

  const toggle = async () => {
    setBusy(true)
    try {
      if (running) {
        await stopGlider()
        setRunning(false)
      } else {
        const listen = Number(listenPort)
        const target = Number(targetPort)
        if (
          ![listen, target].every(
            (port) => Number.isInteger(port) && port >= 1 && port <= 65535,
          )
        ) {
          throw new Error(t('settings.sections.glider.invalidPort'))
        }
        await startGlider(listen, targetIp.trim(), target)
        localStorage.setItem('glider.listenPort', listenPort)
        localStorage.setItem('glider.targetIp', targetIp.trim())
        localStorage.setItem('glider.targetPort', targetPort)
        setRunning(true)
      }
    } catch (error) {
      showNotice.error(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingList title={t('settings.sections.glider.title')}>
      <Box sx={{ px: 2, pb: 2 }}>
        <Stack spacing={2}>
          <TextField
            size="small"
            label={t('settings.sections.glider.listenPort')}
            value={listenPort}
            onChange={(e) => setListenPort(e.target.value)}
            disabled={running || busy}
          />
          <TextField
            size="small"
            label={t('settings.sections.glider.targetIp')}
            value={targetIp}
            onChange={(e) => setTargetIp(e.target.value)}
            disabled={running || busy}
          />
          <TextField
            size="small"
            label={t('settings.sections.glider.targetPort')}
            value={targetPort}
            onChange={(e) => setTargetPort(e.target.value)}
            disabled={running || busy}
          />
          <Typography variant="caption">
            {t('settings.sections.glider.listenWarning')}
          </Typography>
          <Button variant="contained" onClick={toggle} disabled={busy}>
            {t(
              running
                ? 'settings.sections.glider.stop'
                : 'settings.sections.glider.start',
            )}
          </Button>
        </Stack>
      </Box>
    </SettingList>
  )
}

export default SettingGlider
