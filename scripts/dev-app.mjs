import { spawn } from 'node:child_process'

const children = [
  spawn('python3', ['server.py'], { stdio: 'inherit' }),
  spawn('vite', ['--host', '127.0.0.1'], { stdio: 'inherit', shell: process.platform === 'win32' }),
]

function stop(signal) {
  for (const child of children) child.kill(signal)
}
process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
for (const child of children) child.on('exit', (code) => {
  if (code && code !== 0) { stop('SIGTERM'); process.exitCode = code }
})
