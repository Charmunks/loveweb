const express = require('express')
const compression = require('compression')
const rateLimit = require('express-rate-limit')
const fs = require('fs-extra')
const path = require('path')
const os = require('os')
const { v4: uuidv4 } = require('uuid')
const { compileLoveProjects } = require('./love.utils')
const { addGame, getGameByName } = require('./db.utils')
const app = express()
app.set('trust proxy', 1)
require('dotenv').config()
const port = process.env.PORT ?? 3000
const cdn = process.env.CDN_URL
const cdnToken = process.env.CDN_KEY

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
})

app.use(compression())
app.use(express.json({ limit: '50mb' }))
app.use(express.static(path.join(__dirname, 'public')))

app.get('/builder', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'builder.html'))
})

const loveAssetsPath = path.join(__dirname, 'node_modules/love.js/src/compat')
app.get('/love.wasm', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  res.setHeader('Content-Type', 'application/wasm')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.sendFile(path.join(loveAssetsPath, 'love.wasm'))
})
app.get('/love.js', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  res.setHeader('Content-Type', 'application/javascript')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.sendFile(path.join(loveAssetsPath, 'love.js'))
})

app.use(apiLimiter)

async function uploadToCDN(fileUrls) {
  const response = await fetch(cdn, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${cdnToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(fileUrls)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`CDN request failed: ${response.status} ${text}`);
  }

  return response.json();
}



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

app.post('/upload', async (req, res) => {
  const { files, gameName, title = 'Love Game', memory = 67108864, compatibility = false } = req.body

  if (!gameName || typeof gameName !== 'string') {
    return res.status(400).json({ error: 'gameName is required' })
  }

  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'files must be a non-empty array' })
  }

  const existingGame = await getGameByName(gameName)
  if (existingGame) {
    return res.status(400).json({ error: 'A game with this name already exists' })
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

    await compileLoveProjects(projects, { output: outputDir, memory, compatibility: true })

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

    const tempId = uuidv4()
    const tempHtmlPath = path.join(os.tmpdir(), `${tempId}.html`)
    await fs.writeFile(tempHtmlPath, html)

    const baseUrl = `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`
    const tempUrl = `${baseUrl}/temp/${tempId}.html`

    app.get(`/temp/${tempId}.html`, (tempReq, tempRes) => {
      tempRes.setHeader('Content-Type', 'text/html')
      tempRes.sendFile(tempHtmlPath, async () => {
        await fs.remove(tempHtmlPath).catch(() => {})
      })
    })

    const cdnResult = await uploadToCDN([tempUrl])
    await fs.remove(tempHtmlPath).catch(() => {})

    const cdnLink = cdnResult.files[0].deployedUrl
    const authorIp = req.headers['x-forwarded-for']?.split(',')[0] || req.ip

    await addGame(gameName, authorIp, cdnLink)

    res.json({ success: true })
  } catch (err) {
    console.error('Upload error:', err)
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

const multer = require('multer')
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

app.post('/compile-love', upload.single('lovefile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No .love file uploaded' })
  }

  const { title = 'Love Game', output = 'html' } = req.body
  const outputDir = path.join(os.tmpdir(), `loveweb-${uuidv4()}`)
  const loveFilePath = path.join(os.tmpdir(), `${uuidv4()}.love`)

  try {
    await fs.writeFile(loveFilePath, req.file.buffer)

    const AdmZip = require('adm-zip')
    const zip = new AdmZip(req.file.buffer)
    const entries = zip.getEntries()
    const gameFiles = []

    for (const entry of entries) {
      if (!entry.isDirectory) {
        const data = entry.getData()
        gameFiles.push({ path: entry.entryName, data: data.toString('base64') })
      }
    }

    const filesJson = JSON.stringify(gameFiles)
    const baseUrl = `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`

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
    var baseUrl = '${baseUrl}';
    
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

    if (output === 'link') {
      const gameName = req.body.gameName
      if (!gameName || typeof gameName !== 'string') {
        return res.status(400).json({ error: 'gameName is required for link output' })
      }

      const existingGame = await getGameByName(gameName)
      if (existingGame) {
        return res.status(400).json({ error: 'A game with this name already exists' })
      }

      const tempId = uuidv4()
      const tempHtmlPath = path.join(os.tmpdir(), `${tempId}.html`)
      await fs.writeFile(tempHtmlPath, html)

      const tempUrl = `${baseUrl}/temp/${tempId}.html`

      app.get(`/temp/${tempId}.html`, (tempReq, tempRes) => {
        tempRes.setHeader('Content-Type', 'text/html')
        tempRes.sendFile(tempHtmlPath, async () => {
          await fs.remove(tempHtmlPath).catch(() => {})
        })
      })

      const cdnResult = await uploadToCDN([tempUrl])
      await fs.remove(tempHtmlPath).catch(() => {})

      const cdnLink = cdnResult.files[0].deployedUrl
      const authorIp = req.headers['x-forwarded-for']?.split(',')[0] || req.ip

      await addGame(gameName, authorIp, cdnLink)

      res.json({ success: true, playUrl: `/play/${gameName}` })
    } else {
      res.setHeader('Content-Type', 'text/html')
      res.setHeader('Content-Disposition', `attachment; filename="${title}.html"`)
      res.send(html)
    }
  } catch (err) {
    console.error('Compile love error:', err)
    res.status(500).json({ error: err.message })
  } finally {
    fs.remove(loveFilePath).catch(() => {})
    fs.remove(outputDir).catch(() => {})
  }
})

app.get('/play/:gameName', async (req, res) => {
  try {
    const game = await getGameByName(req.params.gameName)
    if (!game) {
      return res.status(404).send('Game not found')
    }
    const response = await fetch(game.cdn_link)
    const html = await response.text()
    res.setHeader('Content-Type', 'text/html')
    res.send(html)
  } catch (err) {
    res.status(500).send('Error loading game')
  }
})

app.listen(port, () => {
  console.log(`Listening on port ${port}`)
})
