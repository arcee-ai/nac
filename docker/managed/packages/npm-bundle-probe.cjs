'use strict'
// Isolated local protocol regression for the actual npm-bundled Undici copy.
const assert = require('node:assert/strict')
const { once } = require('node:events')
const { createServer } = require('node:net')
const { fetch, Client } = require(process.argv[2])

async function main () {
  const early = process.argv[3] === 'early-close'
  const encoding = Array(early ? 6 : 5).fill(early ? 'gzip' : 'identity').join(', ')
  const server = createServer(socket => {
    socket.once('data', () => socket.end(
      `HTTP/1.1 200 OK\r\nContent-Encoding: ${encoding}\r\n` +
      'Content-Length: 4\r\nConnection: close\r\n\r\n' + (early ? '' : 'test')))
  })
  await once(server.listen(0, '127.0.0.1'), 'listening')
  const address = `http://127.0.0.1:${server.address().port}`
  const client = new Client(address)
  try {
    if (early) {
      await assert.rejects(fetch(address, { dispatcher: client }), error => {
        assert.match(error.cause?.message, /content-encoding/)
        return true
      })
    } else {
      assert.equal(await (await fetch(address, { dispatcher: client })).text(), 'test')
    }
    await client.close()
    // Let socket error delivery finish before claiming process survival.
    await new Promise(resolve => setImmediate(resolve))
  } finally {
    server.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
