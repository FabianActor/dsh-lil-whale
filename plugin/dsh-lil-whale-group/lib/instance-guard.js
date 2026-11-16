// dsh-lil-whale-group —— 进程内单实例防护（2026-11-16 第五份装机沉淀 P1）
//
// 问题：DSH 在**同一个进程里**卸载/重装插件时，旧 fiber 的 `dispose` 不一定被触发。
// 旧实例于是继续跑定时器、按**加载时**算出的配置写旧目录，甚至把已经删掉的目录重建出来
// （实测：一个进程里同时活着 3 个实例，各写各的 pool；删掉旧目录一分钟内又长回来）。
//
// 做法：在系统临时目录里维护一张**按 pid 分文件**的实例登记表（与配置路径无关，
// 所以旧实例和新实例一定看得到同一张表）。每个实例登记一行 {id, at, ...}。
// 每拍检查：表里若有比自己"新"的实例，就把自己的定时器全停掉，并写一行幽灵实例的记录。
// 不依赖 dispose，也不依赖配置文件的位置——旧实例的配置早就指向别处了。

import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const TTL_MS = 60 * 60 * 1000
// 幽灵实例的记录也写在临时目录：不能写进 pool（那正是它要重建的旧目录）。
const LOG_DIR = join(tmpdir(), 'lil-whale')
const LOG_FILE = join(LOG_DIR, 'instances.log')

export function registryPathFor(pid = process.pid) {
  return join(LOG_DIR, 'instances', `${pid}.json`)
}

function readRegistry(pid) {
  try {
    const raw = JSON.parse(readFileSync(registryPathFor(pid), 'utf8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function writeRegistry(pid, list) {
  try {
    const file = registryPathFor(pid)
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 6)}.tmp`
    writeFileSync(tmp, JSON.stringify(list), 'utf8')
    renameSync(tmp, file)
  } catch {
    // 登记表坏了只影响"能不能互相发现"，不该拦住插件本身。
  }
}

export function registerInstance(info = {}) {
  const pid = process.pid
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const entry = {
    id,
    at: Date.now(),
    pid,
    selfHome: info.selfHome ?? null,
    configFile: info.configFile ?? null,
    profile: info.profile ?? null,
  }
  const now = Date.now()
  const list = readRegistry(pid).filter((e) => e && now - Number(e.at || 0) < TTL_MS)
  writeRegistry(pid, [...list, entry])

  let retired = false
  let logged = false
  const timers = []

  return {
    id,
    entry,
    addTimer(timer) {
      if (timer) timers.push(timer)
      return timer
    },
    // true = 本实例已被同进程里更新的实例顶替，调用方应停止一切状态写入。
    isGhost() {
      if (retired) return true
      const t = Date.now()
      const newer = readRegistry(pid).some(
        (e) => e && e.id !== id && t - Number(e.at || 0) < TTL_MS && Number(e.at || 0) > entry.at,
      )
      if (!newer) return false
      retired = true
      if (!logged) {
        logged = true
        const line = `ghost-instance | pid=${pid} id=${id} selfHome=${entry.selfHome} configFile=${entry.configFile} profile=${entry.profile}`
        try {
          mkdirSync(LOG_DIR, { recursive: true })
          appendFileSync(LOG_FILE, `${new Date().toISOString()} | ${line}\n`, 'utf8')
        } catch {}
        console.error(`[lil-whale] ${line} —— 同一进程里有更新的实例，本实例已停表`)
      }
      return true
    },
    retire() {
      retired = true
      for (const timer of timers) {
        try {
          clearInterval(timer)
          clearTimeout(timer)
        } catch {}
      }
      timers.length = 0
    },
    unregister() {
      writeRegistry(
        pid,
        readRegistry(pid).filter((e) => e && e.id !== id),
      )
    },
  }
}
