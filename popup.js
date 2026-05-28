let isUnlocked = false;

// 检查主密码
async function checkMasterPassword() {
    const { masterHash } = await chrome.storage.local.get('masterHash');

    if (!masterHash) {
        return showSetupForm();
    }

    showLoginForm();
    return false;
}

// 显示设置密码表单
function showSetupForm() {
    const html = `
    <h3>🔐 设置主密码</h3>
    <div class="form">
        <input type="password" id="masterPwd" placeholder="设置主密码">
        <input type="password" id="confirmPwd" placeholder="确认主密码">
        <p>主密码用于加密和保护您的密码本，请牢记！如果忘记无法找回！</p>
        <div id="errorMsg" style="color: var(--dark-orange); font-size: 12px; margin: 5px 0;"></div>
        <button id="setupBtn" style="width: 100%;">设置密码</button>
    </div>
    `;
    document.getElementById('app').innerHTML = html;

    document.getElementById('setupBtn').addEventListener('click', setupMasterPassword);
}

// 显示登录表单
function showLoginForm() {
    const html = `
    <h3>🔐 倦意密码本</h3>
    <div class="form">
        <input type="password" id="masterPwd" placeholder="输入主密码">
        <div id="errorMsg" style="color: var(--dark-orange); font-size: 12px; margin: 5px 0;"></div>
        <button id="loginBtn" style="width: 100%;">解锁</button>
    </div>
    `;
    document.getElementById('app').innerHTML = html;

    document.getElementById('loginBtn').addEventListener('click', verifyMasterPassword);
}

// 设置主密码
async function setupMasterPassword() {
    const pwd = document.getElementById('masterPwd').value;
    const confirmPwd = document.getElementById('confirmPwd').value;
    const errorMsg = document.getElementById('errorMsg');

    if (!pwd || !confirmPwd) {
        errorMsg.textContent = '请输入密码';
        return;
    }

    if (pwd !== confirmPwd) {
        errorMsg.textContent = '两次输入的密码不一致';
        return;
    }

    if (pwd.length < 4) {
        errorMsg.textContent = '密码至少4位';
        return;
    }

    const hash = await sha256(pwd);
    await chrome.storage.local.set({ masterHash: hash });
    isUnlocked = true;
    await chrome.storage.session.set({ sessionUnlocked: true });
    loadRecords();
}

// 验证主密码
async function verifyMasterPassword() {
    const pwd = document.getElementById('masterPwd').value;
    const errorMsg = document.getElementById('errorMsg');

    if (!pwd) {
        errorMsg.textContent = '请输入密码';
        return;
    }

    const { masterHash } = await chrome.storage.local.get('masterHash');
    const hash = await sha256(pwd);

    if (hash === masterHash) {
        isUnlocked = true;
        await chrome.storage.session.set({ sessionUnlocked: true });
        loadRecords();
    } else {
        errorMsg.textContent = '密码错误';
    }
}

// SHA256加密函数
async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0')).join('');
}

// 添加记录弹窗
function showAddForm() {
    const html = `
    <div class="form">
      <input type="text" id="site" placeholder="网站">
      <input type="text" id="account" placeholder="账号">
      <input type="password" id="password" placeholder="密码">
      <textarea id="note" placeholder="备注"></textarea>
      <button id="saveBtn">保存</button>
      <button id="cancelBtn">取消</button>
    </div>
  `;
    document.getElementById('app').innerHTML = html;

    document.getElementById('saveBtn').addEventListener('click', saveRecord);
    document.getElementById('cancelBtn').addEventListener('click', loadRecords);
}

// 保存记录
async function saveRecord() {
    const masterPwd = document.getElementById('masterPwd') ? document.getElementById('masterPwd').value : null;
    if (!masterPwd && !isUnlocked) {
        showStatus('请先解锁');
        return;
    }

    const key = await getEncryptionKey(masterPwd || '');
    const encryptedPwd = await encrypt(
        document.getElementById('password').value,
        key
    );

    const record = {
        site: document.getElementById('site').value,
        account: document.getElementById('account').value,
        password: encryptedPwd, // 保存加密后的密码
        note: document.getElementById('note').value,
        id: Date.now()
    };

    const { records = [] } = await chrome.storage.local.get('records');
    records.push(record);
    await chrome.storage.local.set({ records });
    loadRecords();
}

// 加载记录列表
async function loadRecords() {
    const { records = [] } = await chrome.storage.local.get('records');

    let html = '<h3>🔐 倦意密码本</h3>';
    html += '<div id="status"></div>';
    html += '<div id="searchContainer"></div>';
    html += '<div id="records"></div>';
    html += '<button id="addBtn">添加新密码</button>';
    html += '<button id="importBtn">导入密码</button>';
    html += '<button id="exportBtn">导出密码</button>';

    document.getElementById('app').innerHTML = html;

    // 重新绑定事件
    document.getElementById('addBtn').addEventListener('click', showAddForm);
    document.getElementById('importBtn').addEventListener('click', importRecords);
    document.getElementById('exportBtn').addEventListener('click', exportRecords);

    // 添加搜索框
    addSearchBar();

    // 显示记录
    displayRecords(records);
}

// 导入记录
// 导入记录
async function importRecords() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt';

    input.onchange = async(e) => {
        const file = e.target.files[0];
        if (!file) return;

        const text = await file.text();
        const lines = text.split('\n').filter(line => line.trim());

        const masterPwd = document.getElementById('masterPwd') ?
            document.getElementById('masterPwd').value : null;
        if (!masterPwd && !isUnlocked) {
            alert('请先解锁');
            return;
        }

        const key = await getEncryptionKey(masterPwd || '');

        // 询问用户导入方式
        const importMode = confirm('是否清空现有记录后导入？\n\n点击"确定"：清空现有记录后导入\n点击"取消"：追加到现有记录');

        let records = [];
        if (!importMode) {
            // 追加模式：保留现有记录
            const existing = await chrome.storage.local.get('records');
            records = existing.records || [];
        }
        // 清空模式：records 保持空数组

        for (const line of lines) {
            const parts = line.split('|').map(p => p.trim());
            if (parts.length >= 3) {
                // 检查密码是否已经是加密格式
                let encryptedPwd;
                try {
                    const parsed = JSON.parse(parts[2]);
                    if (parsed.iv && parsed.data) {
                        encryptedPwd = parsed;
                    } else {
                        encryptedPwd = await encrypt(parts[2], key);
                    }
                } catch {
                    encryptedPwd = await encrypt(parts[2], key);
                }

                // 生成整数类型的 id
                const id = Math.floor(Date.now() + Math.random() * 1000);

                records.push({
                    site: parts[0] || '',
                    account: parts[1] || '',
                    password: encryptedPwd,
                    note: parts[3] || '',
                    id: id
                });
            }
        }

        await chrome.storage.local.set({ records });
        loadRecords();
        showStatus('导入成功！', 'success');
    };

    input.click();
}



// 导出记录
async function exportRecords() {
    const { records = [] } = await chrome.storage.local.get('records');

    if (records.length === 0) {
        showStatus('没有可导出的记录');
        return;
    }

    const masterPwd = document.getElementById('masterPwd') ?
        document.getElementById('masterPwd').value : null;
    if (!masterPwd && !isUnlocked) {
        showStatus('请先解锁');
        return;
    }

    const key = await getEncryptionKey(masterPwd || '');
    let content = '';

    for (const record of records) {
        const decryptedPwd = await decrypt(record.password, key);
        content += `${record.site}|${record.account}|${decryptedPwd}|${record.note || ''}\n`;
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `倦意密码本_${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);

    showStatus('导出成功！', 'success');
}

// 显示状态提示
function showStatus(message, type = 'warning') {
    const statusDiv = document.getElementById('status');
    if (!statusDiv) return;

    statusDiv.innerHTML = `<div class="status ${type}">${message}</div>`;
    setTimeout(() => {
        statusDiv.innerHTML = '';
    }, 3000);
}


// 显示记录
function displayRecords(records) {
    const recordsDiv = document.getElementById('records');
    if (!recordsDiv) return;

    // 设置记录容器的最大高度和滚动条
    recordsDiv.style.maxHeight = '300px'; // 设置最大高度
    recordsDiv.style.overflowY = 'auto'; // 垂直滚动
    recordsDiv.style.overflowX = 'hidden'; // 隐藏水平滚动
    recordsDiv.style.paddingRight = '5px'; // 给滚动条留空间
    recordsDiv.style.marginBottom = '5px';

    let html = '';

    if (records.length === 0) {
        html = '<div class="status">暂无记录，点击下方按钮添加</div>';
    } else {
        records.forEach(record => {
            html += `
            <div class="record" data-id="${record.id}">
                <strong>${record.site}</strong>
                <div style="margin-top: 8px;">
                    账号: ${record.account}<br>
                    密码: <span class="pwd">******</span>
                    <button class="show-pwd-btn" data-id="${record.id}">显示</button><br>
                    备注: ${record.note || '无'}
                </div>
                <div style="margin-top: 8px;">
                    <button class="edit-btn" data-id="${record.id}">编辑</button>
                    <button class="delete-btn" data-id="${record.id}">删除</button>
                </div>
            </div>
            `;
        });
    }

    recordsDiv.innerHTML = html;
}

// 添加搜索框
function addSearchBar() {
    const searchContainer = document.getElementById('searchContainer');
    if (!searchContainer) return;

    searchContainer.innerHTML = `
    <div style="margin: 15px 0;">
      <input type="text" id="searchInput" placeholder="🔍 搜索网站或账号...">
      <button id="searchBtn" style="background: var(--light-orange);">搜索</button>
      <button id="clearSearchBtn" style="background: var(--medium-gray); color: var(--dark-gray);">清除</button>
    </div>
  `;
}

// 搜索记录
async function searchRecords() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;

    const keyword = searchInput.value.trim().toLowerCase();
    if (!keyword) {
        showStatus('请输入搜索关键词');
        return;
    }

    const { records = [] } = await chrome.storage.local.get('records');
    const filtered = records.filter(record =>
        record.site.toLowerCase().includes(keyword) ||
        record.account.toLowerCase().includes(keyword)
    );

    displayRecords(filtered);
}

// 清除搜索
function clearSearch() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.value = '';
    }
    loadRecords();
}

// 显示/隐藏密码
async function showPwd(id) {
    const masterPwd = document.getElementById('masterPwd') ? document.getElementById('masterPwd').value : null;
    if (!masterPwd && !isUnlocked) {
        showStatus('请先解锁');
        return;
    }

    const { records = [] } = await chrome.storage.local.get('records');
    const record = records.find(r => r.id === id);

    if (!record) return;

    const key = await getEncryptionKey(masterPwd || '');
    const decryptedPwd = await decrypt(record.password, key);

    const recordElement = document.querySelector(`.record[data-id="${id}"]`);
    if (!recordElement) return;

    const pwdSpan = recordElement.querySelector('.pwd');
    const showBtn = recordElement.querySelector('.show-pwd-btn');

    if (!pwdSpan || !showBtn) return;

    if (pwdSpan.textContent === '******') {
        pwdSpan.textContent = decryptedPwd;
        pwdSpan.style.color = 'var(--primary-orange)';
        pwdSpan.style.fontWeight = 'bold';
        showBtn.textContent = '隐藏';
    } else {
        pwdSpan.textContent = '******';
        pwdSpan.style.color = '';
        pwdSpan.style.fontWeight = '';
        showBtn.textContent = '显示';
    }
}

// 编辑记录
async function editRecord(id) {
    console.log('编辑记录，传入的id:', id, '类型:', typeof id);

    // 确保 id 是数字类型
    id = Number(id);

    const { records = [] } = await chrome.storage.local.get('records');
    console.log('所有记录:', records);

    const record = records.find(r => r.id === id);
    console.log('找到的记录:', record);

    if (!record) {
        console.error('未找到记录，id:', id, '所有id:', records.map(r => ({ id: r.id, type: typeof r.id })));
        showStatus('未找到记录');
        return;
    }

    // 解密密码用于编辑
    const masterPwd = document.getElementById('masterPwd') ?
        document.getElementById('masterPwd').value : null;
    if (!masterPwd && !isUnlocked) {
        showStatus('请先解锁');
        return;
    }

    const key = await getEncryptionKey(masterPwd || '');
    const decryptedPwd = await decrypt(record.password, key);

    const html = `
    <div class="form">
      <input type="text" id="editSite" value="${record.site}">
      <input type="text" id="editAccount" value="${record.account}">
      <input type="password" id="editPassword" value="${decryptedPwd}">
      <textarea id="editNote">${record.note || ''}</textarea>
      <button id="saveEditBtn">保存</button>
      <button id="cancelEditBtn">取消</button>
    </div>
  `;
    document.getElementById('app').innerHTML = html;

    document.getElementById('saveEditBtn').addEventListener('click', () => saveEdit(id));
    document.getElementById('cancelEditBtn').addEventListener('click', loadRecords);
}

// 保存编辑
async function saveEdit(id) {
    const masterPwd = document.getElementById('masterPwd') ? document.getElementById('masterPwd').value : null;
    if (!masterPwd && !isUnlocked) {
        showStatus('请先解锁');
        return;
    }

    const { records = [] } = await chrome.storage.local.get('records');
    const index = records.findIndex(r => r.id === id);

    if (index === -1) return;

    const key = await getEncryptionKey(masterPwd || '');
    const encryptedPwd = await encrypt(
        document.getElementById('editPassword').value,
        key
    );

    records[index] = {
        ...records[index],
        site: document.getElementById('editSite').value,
        account: document.getElementById('editAccount').value,
        password: encryptedPwd, // 保存加密后的密码
        note: document.getElementById('editNote').value
    };

    await chrome.storage.local.set({ records });
    loadRecords();
}

// 删除记录
async function deleteRecord(id) {
    if (!confirm('确定删除这条记录吗？')) return;

    const { records = [] } = await chrome.storage.local.get('records');
    const newRecords = records.filter(r => r.id !== id);

    await chrome.storage.local.set({ records: newRecords });
    loadRecords();
}

// 加密函数
async function encrypt(text, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(text);
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        key, { name: 'AES-GCM' },
        false, ['encrypt']
    );
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv },
        cryptoKey,
        encoded
    );
    return {
        iv: Array.from(iv),
        data: Array.from(new Uint8Array(encrypted))
    };
}

// 解密函数
async function decrypt(encryptedObj, key) {
    const iv = new Uint8Array(encryptedObj.iv);
    const data = new Uint8Array(encryptedObj.data);
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        key, { name: 'AES-GCM' },
        false, ['decrypt']
    );
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv },
        cryptoKey,
        data
    );
    return new TextDecoder().decode(decrypted);
}

// 生成加密密钥（基于主密码）
async function getEncryptionKey(masterPassword) {
    const hash = await sha256(masterPassword);
    return new TextEncoder().encode(hash.slice(0, 32));
}


// 事件处理函数
function handleClick(event) {
    const target = event.target;

    if (target.classList.contains('show-pwd-btn') ||
        target.classList.contains('edit-btn') ||
        target.classList.contains('delete-btn')) {

        // 从最近的 .record 元素获取 id
        const recordElement = target.closest('.record');
        if (!recordElement) return;

        const id = Number(recordElement.getAttribute('data-id'));
        console.log('点击按钮，获取的id:', id);

        if (target.classList.contains('show-pwd-btn')) {
            showPwd(id);
        } else if (target.classList.contains('edit-btn')) {
            editRecord(id);
        } else if (target.classList.contains('delete-btn')) {
            deleteRecord(id);
        }
        return;
    }

    if (target.id === 'searchBtn') {
        searchRecords();
        return;
    }

    if (target.id === 'clearSearchBtn') {
        clearSearch();
        return;
    }
}

const version = chrome.runtime.getManifest().version;
document.getElementById('version').textContent = version;


// 初始化
document.addEventListener('DOMContentLoaded', async() => {
    // 添加事件监听器
    document.addEventListener('click', handleClick);

    // 检查 session 中是否已解锁
    const { sessionUnlocked } = await chrome.storage.session.get('sessionUnlocked');
    if (sessionUnlocked) {
        isUnlocked = true;
        loadRecords();
    } else {
        await checkMasterPassword();
    }
});