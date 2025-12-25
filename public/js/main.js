require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });

let tabs = [
    { filename: "main.lua", folder: null, type: "lua", content: `function love.draw()
	love.graphics.printf("Hello World!", 0, 300, love.graphics.getWidth(), 'center')
end`, editor: null, container: null },
    { filename: "conf.lua", folder: null, type: "lua", content: `function love.conf(t)
	t.window.title = "My Game"
	t.window.width = 800
	t.window.height = 600
end`, editor: null, container: null }
]

let folders = []
let expandedFolders = new Set()

function getFullPath(tab) {
    return tab.folder ? `${tab.folder}/${tab.filename}` : tab.filename;
}

function toggleFolder(folderName) {
    if (expandedFolders.has(folderName)) {
        expandedFolders.delete(folderName);
    } else {
        expandedFolders.add(folderName);
    }
    renderTabs();
}

function deleteFolder(event, folderName) {
    event.stopPropagation();
    const filesInFolder = tabs.filter(t => t.folder === folderName);
    if (!confirm(`Delete folder "${folderName}" and ${filesInFolder.length} file(s)?`)) return;
    
    for (let i = tabs.length - 1; i >= 0; i--) {
        if (tabs[i].folder === folderName) {
            if (tabs[i].container) tabs[i].container.remove();
            tabs.splice(i, 1);
            if (opentab > i) opentab--;
        }
    }
    folders = folders.filter(f => f !== folderName);
    
    if (opentab >= tabs.length) opentab = Math.max(0, tabs.length - 1);
    if (tabs.length === 0) {
        tabs.push({ filename: 'main.lua', folder: null, type: 'lua', content: '', editor: null, container: null });
        createTabContainer(0);
    } else if (!tabs[opentab].container) {
        createTabContainer(opentab);
    }
    tabs[opentab].container.style.display = 'block';
    renderTabs();
}

function getFileType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (ext === 'lua') return 'lua';
    if (['jpg', 'jpeg', 'png', 'bmp'].includes(ext)) return 'image';
    if (['wav', 'mp3', 'ogg'].includes(ext)) return 'audio';
    return 'unknown';
}

let opentab = 0
let monacoLoaded = false

function changeTab(newtab) {
    if (newtab === opentab || !monacoLoaded) return;
    
    save();
    tabs[opentab].container.style.display = 'none';
    opentab = newtab;
    
    if (!tabs[opentab].container) {
        createTabContainer(opentab);
    }
    
    tabs[opentab].container.style.display = 'block';
    renderTabs();
}

function createTabContainer(index) {
    const tab = tabs[index];
    const editorWrapper = document.getElementById('editor-container');
    const container = document.createElement('div');
    container.className = 'editor-instance';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.position = 'absolute';
    editorWrapper.appendChild(container);
    tab.container = container;

    if (tab.type === 'lua') {
        tab.editor = monaco.editor.create(container, {
            value: tab.content,
            language: 'lua',
            theme: 'vs-dark',
            automaticLayout: true,
            fontSize: 14,
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            wordWrap: 'on'
        });
    } else if (tab.type === 'image') {
        container.innerHTML = `<div class="media-preview"><img src="${tab.dataUrl}" alt="${tab.filename}"></div>`;
    } else if (tab.type === 'audio') {
        container.innerHTML = `<div class="media-preview"><audio controls src="${tab.dataUrl}"></audio><p>${tab.filename}</p></div>`;
    }
}

function base64(str) {
    const utf8Bytes = new TextEncoder().encode(str);
    const binaryString = String.fromCharCode(...utf8Bytes);
    return btoa(binaryString);
}

function renderTabs() {
    const tabsContainer = document.getElementById('tabs');
    let html = '';
    
    const rootFiles = tabs.map((tab, index) => ({ tab, index })).filter(({ tab }) => !tab.folder);
    rootFiles.forEach(({ tab, index }) => {
        html += `<button class="tab${index === opentab ? ' active' : ''}" draggable="true" ondragstart="dragStart(event, ${index})" onclick="changeTab(${index})">
            <span>${tab.filename}</span>
            <span class="tab-close" onclick="deleteTab(event, ${index})">×</span>
        </button>`;
    });
    
    folders.forEach(folderName => {
        const isExpanded = expandedFolders.has(folderName);
        const folderFiles = tabs.map((tab, index) => ({ tab, index })).filter(({ tab }) => tab.folder === folderName);
        
        html += `<div class="folder${isExpanded ? ' expanded' : ''}" ondragover="dragOver(event)" ondrop="dropOnFolder(event, '${folderName}')">
            <button class="folder-header" onclick="toggleFolder('${folderName}')">
                <span class="folder-arrow">${isExpanded ? '▼' : '▶'}</span>
                <span>${folderName}</span>
                <span class="tab-close" onclick="deleteFolder(event, '${folderName}')">×</span>
            </button>
            ${isExpanded ? `<div class="folder-contents">
                ${folderFiles.map(({ tab, index }) => `
                    <button class="tab nested${index === opentab ? ' active' : ''}" draggable="true" ondragstart="dragStart(event, ${index})" onclick="changeTab(${index})">
                        <span>${tab.filename}</span>
                        <span class="tab-close" onclick="deleteTab(event, ${index})">×</span>
                    </button>
                `).join('')}
            </div>` : ''}
        </div>`;
    });
    
    html += `<div class="root-drop" ondragover="dragOver(event)" ondrop="dropOnRoot(event)"></div>`;
    html += `<button class="tab add-tab" onclick="showAddMenu(event)">+</button>`;
    
    tabsContainer.innerHTML = html;
}

let draggedTabIndex = null;

function dragStart(event, index) {
    draggedTabIndex = index;
    event.dataTransfer.effectAllowed = 'move';
}

function dragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
}

function dropOnFolder(event, folderName) {
    event.preventDefault();
    event.stopPropagation();
    if (draggedTabIndex === null) return;
    
    const tab = tabs[draggedTabIndex];
    tab.folder = folderName;
    tab.filename = tab.filename.split('/').pop();
    draggedTabIndex = null;
    renderTabs();
}

function dropOnRoot(event) {
    event.preventDefault();
    if (draggedTabIndex === null) return;
    
    tabs[draggedTabIndex].folder = null;
    draggedTabIndex = null;
    renderTabs();
}

function deleteTab(event, index) {
    event.stopPropagation();
    if (!confirm(`Delete "${getFullPath(tabs[index])}"?`)) return;
    
    if (tabs[index].container) {
        tabs[index].container.remove();
    }
    tabs.splice(index, 1);
    
    if (tabs.length === 0) {
        tabs.push({ filename: 'main.lua', type: 'lua', content: '', editor: null, container: null });
        opentab = 0;
        createTabContainer(0);
    } else if (opentab >= tabs.length) {
        opentab = tabs.length - 1;
        if (!tabs[opentab].container) createTabContainer(opentab);
        tabs[opentab].container.style.display = 'block';
    } else if (index === opentab) {
        if (!tabs[opentab].container) createTabContainer(opentab);
        tabs[opentab].container.style.display = 'block';
    }
    
    renderTabs();
}

function showAddMenu(event) {
    event.stopPropagation();
    closeAddMenu();
    
    const menu = document.createElement('div');
    menu.className = 'add-menu';
    menu.innerHTML = `
        <button onclick="createNewFile()">New File</button>
        <button onclick="createNewFolder()">New Folder</button>
        <button onclick="document.getElementById('file-upload').click(); closeAddMenu();">Upload Files</button>
    `;
    
    const btn = event.target;
    const rect = btn.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.top = rect.bottom + 'px';
    
    document.body.appendChild(menu);
    document.addEventListener('click', closeAddMenu);
}

function closeAddMenu() {
    const existing = document.querySelector('.add-menu');
    if (existing) existing.remove();
    document.removeEventListener('click', closeAddMenu);
}

function createNewFile() {
    closeAddMenu();
    const filename = prompt('Enter filename:', `file${tabs.length + 1}.lua`);
    if (!filename) return;
    
    const newIndex = tabs.length;
    tabs.push({ filename, folder: null, type: 'lua', content: '', editor: null, container: null });
    changeTab(newIndex);
}

function createNewFolder() {
    closeAddMenu();
    const folderName = prompt('Enter folder name:', `folder${folders.length + 1}`);
    if (!folderName) return;
    if (folders.includes(folderName)) {
        alert('Folder already exists');
        return;
    }
    
    folders.push(folderName);
    expandedFolders.add(folderName);
    renderTabs();
}

function handleUpload(event) {
    const files = event.target.files;
    for (const file of files) {
        const type = getFileType(file.name);
        if (type === 'unknown') continue;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const newIndex = tabs.length;
            if (type === 'lua') {
                tabs.push({ filename: file.name, folder: null, type: 'lua', content: e.target.result, editor: null, container: null });
            } else {
                tabs.push({ filename: file.name, folder: null, type, dataUrl: e.target.result, container: null });
            }
            if (monacoLoaded) {
                changeTab(newIndex);
            }
        };
        
        if (type === 'lua') {
            reader.readAsText(file);
        } else {
            reader.readAsDataURL(file);
        }
    }
    event.target.value = '';
}

require(['vs/editor/editor.main'], function () {
    monacoLoaded = true;
    load();
    renderTabs();
    createTabContainer(opentab);
    initResizer();
    
    const iframe = document.getElementById('game');
    iframe.addEventListener('mouseenter', () => iframe.focus());
});

function initResizer() {
    const resizer = document.getElementById('resizer');
    const editorContainer = document.getElementById('editor-container');
    const game = document.getElementById('game');
    const mainContent = document.querySelector('.main-content');
    
    let isResizing = false;
    
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        game.style.pointerEvents = 'none';
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const containerRect = mainContent.getBoundingClientRect();
        const editorWidth = e.clientX - containerRect.left;
        const totalWidth = containerRect.width - resizer.offsetWidth;
        const editorPercent = (editorWidth / totalWidth) * 100;
        const gamePercent = 100 - editorPercent;
        
        if (editorPercent > 10 && gamePercent > 10) {
            editorContainer.style.flex = 'none';
            editorContainer.style.width = editorPercent + '%';
            game.style.width = gamePercent + '%';
        }
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            game.style.pointerEvents = '';
        }
    });
}

async function run(){
    const files = tabs.map(tab => {
        const path = getFullPath(tab);
        let content;
        
        if (tab.type === 'lua') {
            content = tab.editor ? base64(tab.editor.getValue()) : base64(tab.content);
        } else {
            content = tab.dataUrl ? tab.dataUrl.split(',')[1] : '';
        }
        
        return { path, content };
    });

    const response = await fetch('/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files, title: "Love2D WebIDE" }),
    });

    const html = await response.text();
    console.log(html);

    const iframe = document.getElementById("game");
    iframe.srcdoc = html;
    iframe.focus();
}

function stop() {
    const iframe = document.getElementById("game");
    iframe.srcdoc = "";
}

function showExportMenu(event) {
    event.stopPropagation();
    closeExportMenu();
    
    const menu = document.createElement('div');
    menu.className = 'add-menu export-menu';
    menu.innerHTML = `
        <button onclick="exportAs('share')">Export as Sharable Link</button>
        <button onclick="exportAs('html')">Export as HTML</button>
        <button onclick="exportAs('love')">Export as .love</button>
    `;
    menu.onclick = (e) => e.stopPropagation();
    
    const btn = event.target;
    const rect = btn.getBoundingClientRect();
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    menu.style.top = rect.bottom + 'px';
    
    document.body.appendChild(menu);
    document.addEventListener('click', closeExportMenu);
}

function closeExportMenu() {
    const existing = document.querySelector('.export-menu');
    if (existing) existing.remove();
    document.removeEventListener('click', closeExportMenu);
}

async function exportAs(format) {
    closeExportMenu();
    
    const files = tabs.map(tab => {
        const path = getFullPath(tab);
        let content;
        
        if (tab.type === 'lua') {
            content = tab.editor ? base64(tab.editor.getValue()) : base64(tab.content);
        } else {
            content = tab.dataUrl ? tab.dataUrl.split(',')[1] : '';
        }
        
        return { path, content };
    });

    if (format === 'share') {
        const gameName = prompt('Enter a name for your game:');
        if (!gameName) return;

        const response = await fetch('/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files, gameName, title: "Love2D WebIDE" }),
        });

        const result = await response.json();
        if (result.success) {
            const shareUrl = `${window.location.origin}/play/${encodeURIComponent(gameName)}`;
            prompt('Your sharable link:', shareUrl);
        } else {
            alert('Upload failed: ' + (result.error || 'Unknown error'));
        }
        return;
    }

    const isLove = format === 'love';
    const endpoint = isLove ? '/export' : '/compile';
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files, title: "Love2D WebIDE" }),
    });

    if (isLove) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'game.love';
        a.click();
        URL.revokeObjectURL(url);
    } else {
        const html = await response.text();
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'game.html';
        a.click();
        URL.revokeObjectURL(url);
    }
}

function showSaveMenu(event) {
    event.stopPropagation();
    closeSaveMenu();
    
    const menu = document.createElement('div');
    menu.className = 'add-menu save-menu';
    menu.innerHTML = `
        <button onclick="saveAs('browser')">Save to Browser</button>
        <button onclick="saveAs('file')">Save to File</button>
    `;
    menu.onclick = (e) => e.stopPropagation();
    
    const btn = event.target;
    const rect = btn.getBoundingClientRect();
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    menu.style.top = rect.bottom + 'px';
    
    document.body.appendChild(menu);
    document.addEventListener('click', closeSaveMenu);
}

function closeSaveMenu() {
    const existing = document.querySelector('.save-menu');
    if (existing) existing.remove();
    document.removeEventListener('click', closeSaveMenu);
}

function getSaveData() {
    return {
        tabs: tabs.map(tab => ({
            filename: tab.filename,
            folder: tab.folder,
            type: tab.type,
            content: tab.type === 'lua' ? (tab.editor ? tab.editor.getValue() : tab.content) : undefined,
            dataUrl: tab.dataUrl
        })),
        folders: folders,
        opentab: opentab
    };
}

function saveAs(target) {
    closeSaveMenu();
    const saveData = getSaveData();
    
    if (target === 'browser') {
        localStorage.setItem('loveweb-project', JSON.stringify(saveData));
        alert('Saved to browser!');
    } else if (target === 'file') {
        const blob = new Blob([JSON.stringify(saveData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'loveweb-project.json';
        a.click();
        URL.revokeObjectURL(url);
    }
}

function save(showAlert = false) {
    const saveData = getSaveData();
    localStorage.setItem('loveweb-project', JSON.stringify(saveData));
    if (showAlert) alert('Saved!');
}

function loadFromFile() {
    document.getElementById('load-file').click();
}

function handleLoadFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            loadProjectData(data);
            alert('Project loaded!');
        } catch (err) {
            alert('Failed to load project: Invalid JSON file');
            console.error(err);
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function loadProjectData(data) {
    tabs.forEach(tab => {
        if (tab.container) tab.container.remove();
    });
    
    if (data.tabs && data.tabs.length > 0) {
        tabs = data.tabs.map(t => ({
            filename: t.filename,
            folder: t.folder,
            type: t.type,
            content: t.content || '',
            dataUrl: t.dataUrl,
            editor: null,
            container: null
        }));
        folders = data.folders || [];
        opentab = data.opentab || 0;
        if (opentab >= tabs.length) opentab = 0;
        
        renderTabs();
        createTabContainer(opentab);
    }
}

function load() {
    const saved = localStorage.getItem('loveweb-project');
    if (!saved) return false;
    
    try {
        const data = JSON.parse(saved);
        if (data.tabs && data.tabs.length > 0) {
            tabs = data.tabs.map(t => ({
                filename: t.filename,
                folder: t.folder,
                type: t.type,
                content: t.content || '',
                dataUrl: t.dataUrl,
                editor: null,
                container: null
            }));
            folders = data.folders || [];
            opentab = data.opentab || 0;
            if (opentab >= tabs.length) opentab = 0;
            return true;
        }
    } catch (e) {
        console.error('Failed to load saved project:', e);
    }
    return false;
}