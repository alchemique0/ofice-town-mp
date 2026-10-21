// The multiplayer relay: every player sends where he stands and his chat lines, everybody gets the others.
//   locally:  node mp-server/server.mjs        (port 3100; tools/serve.mjs starts it too and also serves it
//             on its own port under /ws, so a tunnel or one open port is enough for the whole game)
//   Railway:  this folder is the service, `npm start`; Railway gives the port in PORT
// The server keeps no story: money and progress stay with each player.
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

/**
 * Starts the relay on its own port (a plain "ok" page there for health checks) and, when `attach` is given,
 * also on that HTTP server under the path /ws. Both lead to the same players.
 */
export function startMultiplayer(port = Number(process.env.PORT || process.env.PORT_MP || 3100), attach = null) {
  const http = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`ok, players: ${players.size}`)
  })
  const wss = new WebSocketServer({ noServer: true })
  const join = (req, socket, head) => wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
  http.on('upgrade', join)
  attach?.on('upgrade', (req, socket, head) => {
    if ((req.url || '').startsWith('/ws')) join(req, socket, head)
    else socket.destroy()
  })
  http.listen(port, '0.0.0.0')
  const players = new Map()
  let nextId = 1

  wss.on('connection', (ws) => {
    if (players.size >= 8) {
      ws.close(1013, 'full')
      return
    }
    const id = nextId++
    const me = { id, name: `Игрок ${id}`, hue: (id * 67) % 360, loc: '', x: 0, y: 0, a: '', oy: 0.96, z: 0, sh: true }
    players.set(ws, me)
    ws.send(JSON.stringify({ t: 'hello', id, name: me.name, hue: me.hue }))
    ws.on('message', (raw) => {
      let m
      try { m = JSON.parse(raw.toString()) } catch { return }
      if (m.t === 'chat') {
        // everybody who is in the game gets the message (the sender shows his own at once)
        const text = String(m.text ?? '').trim().slice(0, 200)
        const now = Date.now()
        if (!text || now - (me.lastChat ?? 0) < 250) return
        me.lastChat = now
        const out = JSON.stringify({ t: 'chat', id: me.id, name: me.name, text, at: now })
        for (const [other, p] of players) if (p !== me && other.readyState === 1) other.send(out)
      }
      else if (m.t === 'state') {
        me.loc = String(m.loc ?? '').slice(0, 40)
        me.x = Number(m.x) || 0
        me.y = Number(m.y) || 0
        me.a = String(m.a ?? '').slice(0, 40)
        me.oy = Number(m.oy) || 0.96
        me.z = Number(m.z) || 0
        me.sh = !!m.sh
      }
    })
    ws.on('close', () => players.delete(ws))
    ws.on('error', () => players.delete(ws))
  })

  setInterval(() => {
    const all = [...players.values()]
    for (const [ws, me] of players) {
      if (ws.readyState !== 1) continue
      const others = all.filter(p => p !== me && p.loc)
      ws.send(JSON.stringify({ t: 'players', list: others }))
    }
  }, 100)

  console.log(`Мультиплеер: ws://<адрес>:${port}`)
  return wss
}

if (process.argv[1] && process.argv[1].split('\\').join('/').endsWith('mp-server/server.mjs')) startMultiplayer()
