const express = require('express')
const fs = require('fs-extra')
const path = require('path')
const os = require('os')
const { v4: uuidv4 } = require('uuid')
const { compileLoveProjects } = require('./love.utils')
const app = express()
require('dotenv').config()
const port = process.env.PORT ?? 3000

app.use(express.json({ limit: '50mb' }))

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.post('/compile', async (req, res) => {
  const { files, title = 'Love Game', memory = 67108864, compatibility = false, singleFile = true } = req.body

  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'files must be a non-empty array' })
  }

  const outputDir = path.join(os.tmpdir(), `loveweb-${uuidv4()}`)
  const srcDir = path.join(os.tmpdir(), `loveweb-src-${uuidv4()}`)

  try {
    let inputPath

    const isSourceFiles = typeof files[0] === 'object' && files[0].path && files[0].content

    if (isSourceFiles) {
      await fs.mkdirs(srcDir)
      for (const file of files) {
        const filePath = path.join(srcDir, file.path)
        await fs.mkdirs(path.dirname(filePath))
        const content = file.content.startsWith('data:')
          ? Buffer.from(file.content.split(',')[1], 'base64')
          : Buffer.from(file.content, 'base64')
        await fs.writeFile(filePath, content)
      }
      inputPath = srcDir
    } else {
      inputPath = files[0]
    }

    const projects = [{ input: inputPath, title }]

    await compileLoveProjects(projects, { output: outputDir, memory, compatibility })

    if (singleFile) {
      const loveJs = await fs.readFile(path.join(outputDir, 'love.js'), 'utf8')
      const gameJs = await fs.readFile(path.join(outputDir, 'game.js'), 'utf8')
      const gameData = await fs.readFile(path.join(outputDir, 'game.data'))
      const gameDataBase64 = gameData.toString('base64')

      const memoryMB = Math.ceil(memory / (1024 * 1024))

      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #1e1e2e; overflow: hidden; }
#container { display: flex; justify-content: center; align-items: center; width: 100%; height: 100%; }
canvas { display: block; }
#loading { color: #cdd6f4; font-family: sans-serif; font-size: 24px; text-align: center; }
</style>
</head>
<body>
<div id="container">
<div id="loading">Loading...</div>
<canvas id="canvas" oncontextmenu="event.preventDefault()" style="display:none;"></canvas>
</div>
<script>
(function() {
var GAME_DATA_BASE64 = "${gameDataBase64}";
function decodeBase64(base64) {
  var binary = atob(base64);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
window.onerror = function(e, u, l) {
  document.getElementById('loading').innerHTML = 'Error: ' + e;
};
window.Module = {
  TOTAL_MEMORY: 1024 * 1024 * ${memoryMB},
  TOTAL_STACK: 1024 * 1024 * 5,
  canvas: document.getElementById('canvas'),
  setWindowTitle: function(t) { document.title = t; },
  preRun: [function() {
    var gameData = decodeBase64(GAME_DATA_BASE64);
    Module.FS_createDataFile('/game.love', null, gameData, true, true, true);
  }],
  postRun: [function() {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('canvas').style.display = 'block';
    Module.canvas.focus();
  }],
  arguments: ['./game.love']
};
})();
</script>
<script>
${loveJs}
</script>
<script>
${gameJs}
</script>
</body>
</html>`

      res.setHeader('Content-Type', 'text/html')
      res.send(html)
    } else {
      const result = {}
      const readDir = async (dir, prefix = '') => {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
          if (entry.isDirectory()) {
            await readDir(fullPath, relativePath)
          } else {
            const content = await fs.readFile(fullPath)
            result[relativePath] = content.toString('base64')
          }
        }
      }
      await readDir(outputDir)
      res.json({ success: true, files: result })
    }
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    fs.remove(outputDir).catch(() => {})
    fs.remove(srcDir).catch(() => {})
  }
})

app.listen(port, () => {
  console.log(`Listening on port ${port}`)
})
