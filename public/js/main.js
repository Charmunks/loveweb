require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });

let value = `function love.draw()
	love.graphics.printf("Hello World!", 0, 300, love.graphics.getWidth(), 'center')
end`

function base64(str) {
  const utf8Bytes = new TextEncoder().encode(str);
  const binaryString = String.fromCharCode(...utf8Bytes);
  return btoa(binaryString);
}

let editor;

require(['vs/editor/editor.main'], function () {
    editor = monaco.editor.create(document.getElementById('editor-container'), {
        value: value,
        language: 'lua',
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 14,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        wordWrap: 'on'
    });
});

async function run(){
    const code = editor.getValue()
    const content = base64(code)
    const url = '/compile';

    const data = `{
    "files": [
        { "path": "main.lua", "content": "${content}" }
    ],
    "title": "Love2D WebIDE"
    }`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
         'Content-Type': 'application/json',
        },
        body: data,
    });

    const html = await response.text();

    console.log(html);

    const iframe = document.getElementById("game");
    iframe.srcdoc = html

}

function save(){
    alert("saved")
}