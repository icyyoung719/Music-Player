const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = __dirname
const DIST_DIR = path.join(ROOT, 'dist')
const SRC_RENDERER_DIR = path.join(ROOT, 'src', 'renderer')
const DIST_RENDERER_DIR = path.join(ROOT, 'dist', 'renderer')

function run(command) {
  execSync(command, {
    cwd: ROOT,
    stdio: 'inherit'
  })
}

function cleanDist() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true })
}

function copyRendererStaticAssets() {
  fs.mkdirSync(DIST_RENDERER_DIR, { recursive: true })

  const shouldCopy = (sourcePath) => {
    const stat = fs.statSync(sourcePath)
    if (stat.isDirectory()) return true
    return !sourcePath.endsWith('.js') && !sourcePath.endsWith('.ts')
  }

  fs.cpSync(SRC_RENDERER_DIR, DIST_RENDERER_DIR, {
    recursive: true,
    force: true,
    filter: shouldCopy
  })
}

function build() {
  cleanDist()

  run('npx tsc -p tsconfig.main.json')
  run('npx tsc -p tsconfig.preload.json')
  run('npx tsc -p tsconfig.renderer.json')

  copyRendererStaticAssets()
}

build()
