const fs = require("fs-extra");
const mustache = require("mustache");
const klawSync = require("klaw-sync");
const path = require("path");
const { sep, resolve } = path;
const { v4: uuidv4 } = require("uuid");
const https = require("https");
const http = require("http");
const os = require("os");

const AUDIO_SUFFIXES = [".ogg", ".wav", ".mp3", ".flac", ".xm"];

function isUrl(str) {
  return /^https?:\/\//i.test(str);
}

function isDataUrl(str) {
  return /^data:/i.test(str);
}

function decodeDataUrl(dataUrl) {
  const matches = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!matches) {
    throw new Error("Invalid data URL format");
  }

  const isBase64 = !!matches[2];
  const data = matches[3];
  const tempPath = path.join(os.tmpdir(), `love-${uuidv4()}.love`);

  if (isBase64) {
    fs.writeFileSync(tempPath, Buffer.from(data, "base64"));
  } else {
    fs.writeFileSync(tempPath, decodeURIComponent(data));
  }

  return tempPath;
}

async function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const tempPath = path.join(os.tmpdir(), `love-${uuidv4()}.love`);
    const file = fs.createWriteStream(tempPath);

    protocol
      .get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          file.close();
          fs.unlinkSync(tempPath);
          downloadFile(response.headers.location).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(tempPath);
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve(tempPath);
        });
      })
      .on("error", (err) => {
        file.close();
        fs.unlink(tempPath, () => {});
        reject(err);
      });
  });
}

function isDirectory(path) {
  return fs.statSync(path).isDirectory();
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getFiles(input) {
  const inputPath = resolve(input);
  if (isDirectory(inputPath)) {
    return klawSync(inputPath, { nodir: true });
  }
  return [{ path: inputPath, stats: fs.statSync(inputPath) }];
}

function buildGameData(inputPath) {
  const files = getFiles(inputPath);
  const isDir = isDirectory(resolve(inputPath));
  const dirs = isDir ? klawSync(resolve(inputPath), { nofile: true }) : [];

  const createFilePaths = dirs.map((f) => {
    const relPath = f.path.replace(
      new RegExp(`^.*${escapeRegex(inputPath)}`),
      ""
    );
    const splits = relPath.split(sep);
    const length = splits.length - 1;
    const directoryPath = splits.slice(0, length).join("/") || "/";
    return `Module['FS_createPath']('${directoryPath}', '${splits[length]}', true, true);`;
  });

  const fileMetadata = [];
  const fileBuffers = [];
  let currentByte = 0;

  for (const file of files) {
    const relativePath = isDir
      ? file.path.replace(new RegExp(`^.*${escapeRegex(inputPath)}`), "")
      : "/game.love";
    const buffer = fs.readFileSync(file.path);
    fileMetadata.push({
      filename: relativePath,
      crunched: 0,
      start: currentByte,
      end: currentByte + buffer.length,
      audio: AUDIO_SUFFIXES.some((suffix) => file.path.endsWith(suffix)),
    });
    currentByte += buffer.length;
    fileBuffers.push(buffer);
  }

  return {
    totalBuffer: Buffer.concat(fileBuffers),
    fileMetadata,
    createFilePaths,
    arguments: isDir ? JSON.stringify(["./"]) : JSON.stringify(["./game.love"]),
  };
}

async function compileLoveProjects(projects, options = {}) {
  const { output, memory = 67108864, compatibility = false } = options;

  if (!output) {
    throw new Error("Output directory is required");
  }

  if (!Array.isArray(projects) || projects.length === 0) {
    throw new Error("Projects must be a non-empty array");
  }

  const outputDir = resolve(output);
  const srcDir = resolve(__dirname, "node_modules/love.js/src");
  const folderName = compatibility ? "compat" : "release";

  fs.mkdirsSync(outputDir);

  const results = [];
  const tempFiles = [];

  try {
    for (const project of projects) {
      const {
        input,
        title = "Love Game",
        subfolder,
      } = typeof project === "string"
        ? { input: project, title: "Love Game", subfolder: null }
        : project;

      let inputPath;
      if (isDataUrl(input)) {
        inputPath = decodeDataUrl(input);
        tempFiles.push(inputPath);
      } else if (isUrl(input)) {
        inputPath = await downloadFile(input);
        tempFiles.push(inputPath);
      } else {
        inputPath = resolve(input);
        if (!fs.existsSync(inputPath)) {
          throw new Error(`Input path does not exist: ${inputPath}`);
        }
      }

      const gameData = buildGameData(inputPath);

      if (memory < gameData.totalBuffer.length) {
        throw new Error(
          `Memory must be >= ${gameData.totalBuffer.length} bytes for ${input}`
        );
      }

      const jsArgs = {
        create_file_paths: gameData.createFilePaths.join("\n    "),
        metadata: JSON.stringify({
          package_uuid: uuidv4(),
          remote_package_size: gameData.totalBuffer.length,
          files: gameData.fileMetadata,
        }),
      };

      const templateArgs = {
        memory,
        title,
        arguments: gameData.arguments,
      };

      const gameTemplate = fs.readFileSync(`${srcDir}/game.js`, "utf8");
      const renderedGameTemplate = mustache.render(gameTemplate, jsArgs);
      const htmlTemplate = fs.readFileSync(
        `${srcDir}/${folderName}/index.html`,
        "utf8"
      );
      const renderedHtml = mustache.render(htmlTemplate, templateArgs);

      const projectOutput = subfolder
        ? resolve(outputDir, subfolder)
        : outputDir;
      fs.mkdirsSync(projectOutput);

      fs.writeFileSync(`${projectOutput}/index.html`, renderedHtml);
      fs.writeFileSync(`${projectOutput}/game.js`, renderedGameTemplate);
      fs.writeFileSync(`${projectOutput}/game.data`, gameData.totalBuffer);
      fs.copySync(
        `${srcDir}/${folderName}/love.js`,
        `${projectOutput}/love.js`
      );
      fs.copySync(
        `${srcDir}/${folderName}/love.wasm`,
        `${projectOutput}/love.wasm`
      );
      fs.copySync(`${srcDir}/${folderName}/theme`, `${projectOutput}/theme`);

      if (!compatibility) {
        fs.copySync(
          `${srcDir}/${folderName}/love.worker.js`,
          `${projectOutput}/love.worker.js`
        );
      }

      results.push({
        input,
        output: projectOutput,
        title,
        size: gameData.totalBuffer.length,
      });
    }

    return results;
  } finally {
    for (const tempFile of tempFiles) {
      fs.unlink(tempFile, () => {});
    }
  }
}

module.exports = {
  compileLoveProjects,
  buildGameData,
};
