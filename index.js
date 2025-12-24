const express = require('express')
const compression = require('compression')
const fs = require('fs-extra')
const path = require('path')
const os = require('os')
const { v4: uuidv4 } = require('uuid')
const { compileLoveProjects } = require('./love.utils')
const app = express()
require('dotenv').config()
const port = process.env.PORT ?? 3000

app.use(compression())
app.use(express.json({ limit: '50mb' }))


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

    await compileLoveProjects(projects, { output: outputDir, memory, compatibility: singleFile ? true : compatibility })

    if (singleFile) {
      const gameFiles = []
      const readSrcDir = async (dir, prefix = '') => {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
          if (entry.isDirectory()) {
            await readSrcDir(fullPath, relativePath)
          } else {
            const content = await fs.readFile(fullPath)
            gameFiles.push({ path: relativePath, data: content.toString('base64') })
          }
        }
      }
      await readSrcDir(inputPath)

      const filesJson = JSON.stringify(gameFiles)

      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #1e1e2e; overflow: hidden; }
#container { display: flex; justify-content: center; align-items: center; width: 100%; height: 100%; }
canvas { display: block; transform-origin: center center; }
#loading { color: #cdd6f4; font-family: sans-serif; font-size: 24px; text-align: center; }
</style>
</head>
<body>
<div id="container">
<div id="loading">Loading...</div>
<canvas id="canvas" oncontextmenu="event.preventDefault()" style="display:none;"></canvas>
</div>
<script>
var GAME_FILES = ${filesJson};
function decodeBase64(base64) {
  var binary = atob(base64);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
window.onerror = function(e, u, l) {
  document.getElementById('loading').innerHTML = 'Error: ' + e;
};

(async function() {
  try {
    var baseUrl = '${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}';
    
    var [loveScript, wasmBinary] = await Promise.all([
      fetch(baseUrl + '/love.js').then(r => r.text()),
      fetch(baseUrl + '/love.wasm').then(r => r.arrayBuffer()).then(b => new Uint8Array(b))
    ]);
    
    var script = document.createElement('script');
    script.textContent = loveScript;
    document.head.appendChild(script);
    
    Love({
      canvas: document.getElementById('canvas'),
      arguments: ['./'],
      wasmBinary: wasmBinary,
      locateFile: function(path) {
        if (path.endsWith('.wasm')) return baseUrl + '/love.wasm';
        return path;
      },
      preRun: [function(Module) {
        for (var i = 0; i < GAME_FILES.length; i++) {
          var file = GAME_FILES[i];
          var parts = file.path.split('/');
          var dir = '/';
          for (var j = 0; j < parts.length - 1; j++) {
            var subdir = parts[j];
            try { Module.FS_createPath(dir, subdir, true, true); } catch(e) {}
            dir = dir + (dir === '/' ? '' : '/') + subdir;
          }
          var data = decodeBase64(file.data);
          Module.FS_createDataFile('/' + parts.slice(0, -1).join('/'), parts[parts.length - 1], data, true, true, true);
        }
      }],
      postRun: [function() {
        document.getElementById('loading').style.display = 'none';
        var canvas = document.getElementById('canvas');
        canvas.style.display = 'block';
        canvas.focus();
        function scaleCanvas() {
          var container = document.getElementById('container');
          var cw = container.clientWidth;
          var ch = container.clientHeight;
          var canvasW = canvas.width;
          var canvasH = canvas.height;
          var scale = Math.min(cw / canvasW, ch / canvasH, 1);
          canvas.style.transform = 'scale(' + scale + ')';
        }
        scaleCanvas();
        window.addEventListener('resize', scaleCanvas);
        new ResizeObserver(scaleCanvas).observe(document.getElementById('container'));
      }]
    }).catch(function(err) {
      document.getElementById('loading').innerHTML = 'Error: ' + err.message;
    });
  } catch(err) {
    document.getElementById('loading').innerHTML = 'Error loading: ' + err.message;
  }
})();
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

app.post('/export', async (req, res) => {
  const { files, title = 'Love Game' } = req.body

  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'files must be a non-empty array' })
  }

  const srcDir = path.join(os.tmpdir(), `loveweb-src-${uuidv4()}`)
  const loveFile = path.join(os.tmpdir(), `${uuidv4()}.love`)

  try {
    const isSourceFiles = typeof files[0] === 'object' && files[0].path && files[0].content

    if (!isSourceFiles) {
      return res.status(400).json({ error: 'files must be an array of {path, content} objects' })
    }

    await fs.mkdirs(srcDir)
    for (const file of files) {
      const filePath = path.join(srcDir, file.path)
      await fs.mkdirs(path.dirname(filePath))
      const content = file.content.startsWith('data:')
        ? Buffer.from(file.content.split(',')[1], 'base64')
        : Buffer.from(file.content, 'base64')
      await fs.writeFile(filePath, content)
    }

    const archiver = require('archiver')
    const output = fs.createWriteStream(loveFile)
    const archive = archiver('zip', { zlib: { level: 9 } })

    await new Promise((resolve, reject) => {
      output.on('close', resolve)
      archive.on('error', reject)
      archive.pipe(output)
      archive.directory(srcDir, false)
      archive.finalize()
    })

    const loveData = await fs.readFile(loveFile)
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${title}.love"`)
    res.send(loveData)
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    fs.remove(srcDir).catch(() => {})
    fs.remove(loveFile).catch(() => {})
  }
})

app.use(express.static(path.join(__dirname, 'public')));

const loveAssetsPath = path.join(__dirname, 'node_modules/love.js/src/compat')
app.get('/love.wasm', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  res.setHeader('Content-Type', 'application/wasm')
  res.sendFile(path.join(loveAssetsPath, 'love.wasm'))
})
app.get('/love.js', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  res.setHeader('Content-Type', 'application/javascript')
  res.sendFile(path.join(loveAssetsPath, 'love.js'))
})

app.listen(port, () => {
  console.log(`Listening on port ${port}`)
})
