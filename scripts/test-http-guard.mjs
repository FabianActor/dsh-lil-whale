import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// 从脚本位置推仓库根：release-check 会把包解到临时目录再跑这个脚本，
// 不能用相对路径（cwd 不一定是包根）。
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SERVER = join(ROOT, 'plugin', 'dsh-lil-whale-group-ui', 'lib', 'index.js')
const CLIENT = join(ROOT, 'plugin', 'dsh-lil-whale-group-ui', 'lib', 'client.js')
const ROUTES = [
  '/group/api/config',
  '/group/api/avatar',
  '/group/api/image',
  '/group/api/send',
  '/group/api/dm',
  '/group/api/read',
  '/pond/api/settings',
  '/pond/api/action',
]

let failed = 0
function check(name, ok, detail = '') {
  if (ok) console.log(`PASS ${name}`)
  else {
    failed += 1
    console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`)
  }
}

const server = readFileSync(SERVER, 'utf8')
const client = readFileSync(CLIENT, 'utf8')

check('guardWrite 存在', server.includes('function guardWrite('))
check('写方法集合存在', server.includes("const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])"))
check('自定义头判据存在', server.includes("['x-llw-panel']"))
check('拒绝时回 403', server.includes("error: 'forbidden'"))
for (const route of ROUTES) check(`写路由有守卫：${route}`, server.includes(`guardWrite(req, res, '${route}')`))
const headerSites = (client.match(/'x-llw-panel': '1'/g) ?? []).length
check('客户端的写请求都带面板头（>=10 处）', headerSites >= 10, `找到 ${headerSites} 处`)
check('客户端写请求仍带 JSON content-type', client.includes("'content-type': 'application/json', 'x-llw-panel': '1'"))

console.log(failed === 0 ? 'OK 写请求守卫齐全' : `FAIL×${failed} 写请求守卫不全`)
process.exit(failed === 0 ? 0 : 1)
