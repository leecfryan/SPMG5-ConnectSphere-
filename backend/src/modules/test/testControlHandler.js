const express = require('express')

function testControlRoutes(dataClient) {
  const router = express.Router()

  router.post('/', async (req, res) => {
    if (req.headers['x-control-key'] !== process.env.PW_CONTROL_KEY) {
      return res.status(403).json({ message: 'Forbidden' })
    }

    const { command, attendeeEmail, eventId } = req.body

    if (command === 'deleteRegistration') {
      if (!attendeeEmail || !eventId) {
        return res.status(400).json({ message: 'attendeeEmail and eventId required' })
      }
      const { data: { users }, error: listError } = await dataClient.auth.admin.listUsers()
      if (listError) return res.status(500).json({ message: 'Failed to list users' })
      const user = users.find(u => u.email === attendeeEmail)
      if (!user) return res.status(404).json({ message: 'User not found' })
      const { error } = await dataClient
        .from('registrations')
        .delete()
        .eq('attendee_id', user.id)
        .eq('event_id', eventId)
      if (error) return res.status(500).json({ message: 'Delete failed' })
      return res.json({ ok: true })
    }

    res.status(400).json({ message: 'Unknown command' })
  })

  return router
}

module.exports = testControlRoutes
