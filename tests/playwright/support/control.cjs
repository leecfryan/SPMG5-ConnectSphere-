const { backendURL } = require('./settings.cjs')

async function deleteRegistration(attendeeEmail, eventId) {
  const res = await fetch(`${backendURL}/api/test/control`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-control-key': process.env.PW_CONTROL_KEY,
    },
    body: JSON.stringify({ command: 'deleteRegistration', attendeeEmail, eventId }),
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`Control endpoint failed: ${res.status} ${await res.text()}`)
  }
}

module.exports = { deleteRegistration }
