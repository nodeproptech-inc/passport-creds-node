import { createServer } from 'node:http'
import { signRequest } from '@worldcoin/idkit/signing'

const host = '127.0.0.1'
const port = 3002
const action = 'identity-check'
const maxRequestBodyBytes = 1_000_000

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(body))
}

function getWorldIdConfig() {
  const {
    WORLD_APP_ID: appId,
    WORLD_RP_ID: rpId,
    RP_SIGNING_KEY: signingKeyHex,
  } = process.env

  if (!appId || !rpId || !signingKeyHex) {
    throw new Error('World ID server configuration is incomplete')
  }

  return { appId, rpId, signingKeyHex }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    let bodySize = 0

    request.on('data', (chunk) => {
      bodySize += chunk.length

      if (bodySize > maxRequestBodyBytes) {
        reject(new Error('Request body is too large'))
        request.resume()
        return
      }

      body += chunk
    })

    request.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch {
        reject(new Error('Request body must be valid JSON'))
      }
    })

    request.on('error', reject)
  })
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/api/health') {
    sendJson(response, 200, { status: 'ok' })
    return
  }

  if (request.method === 'POST' && request.url === '/api/rp-signature') {
    try {
      const { appId, rpId, signingKeyHex } = getWorldIdConfig()
      const { sig, nonce, createdAt, expiresAt } = signRequest({
        signingKeyHex,
        action,
      })

      sendJson(response, 200, {
        app_id: appId,
        rp_context: {
          rp_id: rpId,
          nonce,
          created_at: createdAt,
          expires_at: expiresAt,
          signature: sig,
        },
      })
    } catch (error) {
      console.error('Unable to generate World ID RP signature:', error)
      sendJson(response, 500, { error: 'Unable to generate RP context' })
    }
    return
  }

  if (request.method === 'POST' && request.url === '/api/verify-proof') {
    try {
      const { rpId } = getWorldIdConfig()
      const body = await readJsonBody(request)

      if (!body || typeof body !== 'object' || !('idkitResponse' in body)) {
        sendJson(response, 400, { error: 'Missing IDKit response' })
        return
      }

      const worldResponse = await fetch(
        `https://developer.world.org/api/v4/verify/${rpId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body.idkitResponse),
        },
      )

      if (!worldResponse.ok) {
        console.error('World ID proof verification failed:', worldResponse.status)
        sendJson(response, 400, { error: 'Identity verification failed' })
        return
      }

      sendJson(response, 200, { success: true })
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'Request body is too large' ||
          error.message === 'Request body must be valid JSON')
      ) {
        sendJson(response, 400, { error: error.message })
        return
      }

      console.error('Unable to verify World ID proof:', error)
      sendJson(response, 500, { error: 'Unable to verify identity proof' })
    }
    return
  }

  sendJson(response, 404, { error: 'Not found' })
})

server.listen(port, host, () => {
  console.log(`Local backend listening on http://${host}:${port}`)
})
