#!/usr/bin/env node
/**
 * Install / uninstall this plugin into one DSH profile.
 *
 * The plugin is a plain local package with no dependencies, so installation is
 * three idempotent steps:
 *   1. symlink the package into `<profile>/node_modules`
 *   2. declare it in `<profile>/package.json` so a later `pnpm install` keeps it
 *   3. append its Loader row to `<profile>/cordis.patch.yml`
 *
 * Usage:
 *   node scripts/install.mjs                 # desktop profile
 *   node scripts/install.mjs --profile web   # another profile name
 *   node scripts/install.mjs --remove
 *   node scripts/install.mjs --dry-run
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_NAME = 'dsh-token-calendar'
const ROW_ID = 'token-usage'
const ROW_BLOCK = `\n- insert:\n    - id: ${ROW_ID}\n      name: ${PACKAGE_NAME}\n`
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index === -1 || argv[index + 1] === undefined ? fallback : argv[index + 1]
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const profileName = value('profile', 'desktop')
const profileRoot = resolve(value('profile-dir', join(homedir(), '.dsh', 'profiles', profileName)))
const dryRun = flag('dry-run')
const removing = flag('remove')

const manifestPath = join(profileRoot, 'package.json')
const patchPath = join(profileRoot, 'cordis.patch.yml')
const linkPath = join(profileRoot, 'node_modules', PACKAGE_NAME)

/** Write a file, keeping a timestamped backup of the previous content. */
function backupThenWrite(path, text) {
  if (existsSync(path)) copyFileSync(path, `${path}.bak-${STAMP}`)
  writeFileSync(path, text)
}

if (!existsSync(manifestPath)) {
  console.error(`找不到 profile：${profileRoot}`)
  process.exit(1)
}

const manifestText = readFileSync(manifestPath, 'utf8')
const manifest = JSON.parse(manifestText)
manifest.dependencies ??= {}

const isSymlink = (path) => {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

if (removing) {
  delete manifest.dependencies[PACKAGE_NAME]
  const patch = readFileSync(patchPath, 'utf8')
  const nextPatch = patch.replace(ROW_BLOCK, '\n').replace(/\n{3,}/g, '\n\n')
  if (dryRun) {
    console.log('[dry-run] 移除依赖、Loader 行与符号链接')
  } else {
    backupThenWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    if (nextPatch !== patch) backupThenWrite(patchPath, nextPatch)
    if (existsSync(linkPath) || isSymlink(linkPath)) rmSync(linkPath, { force: true })
    console.log(`已从 ${profileName} 卸载 ${PACKAGE_NAME}；重启 DSH 后生效。`)
  }
  process.exit(0)
}

manifest.dependencies[PACKAGE_NAME] = `link:${packageRoot}`

const patch = readFileSync(patchPath, 'utf8')
const nextPatch = patch.includes(`name: ${PACKAGE_NAME}`) ? patch : `${patch.endsWith('\n') ? patch : `${patch}\n`}${ROW_BLOCK}`

if (dryRun) {
  console.log(`[dry-run] 目标 profile：${profileRoot}`)
  console.log(`[dry-run] 依赖：${PACKAGE_NAME} -> link:${packageRoot}`)
  console.log(`[dry-run] Loader 行：${ROW_ID}${patch.includes(`name: ${PACKAGE_NAME}`) ? '（已存在）' : '（将追加）'}`)
  process.exit(0)
}

if (!existsSync(join(profileRoot, 'node_modules'))) mkdirSync(join(profileRoot, 'node_modules'), { recursive: true })
if (!existsSync(linkPath) && !isSymlink(linkPath)) symlinkSync(packageRoot, linkPath, 'dir')

if (`${JSON.stringify(manifest, null, 2)}\n` !== manifestText) backupThenWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
if (nextPatch !== patch) backupThenWrite(patchPath, nextPatch)

console.log(`已把 ${PACKAGE_NAME} 装进 profile "${profileName}"：`)
console.log(`  包：  ${packageRoot}`)
console.log(`  链接：${linkPath}`)
console.log(`  配置：${patchPath}`)
console.log('重启 DeepSeek Harness 后，设置里会出现「Token 用量」。')
