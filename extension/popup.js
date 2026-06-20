const DEFAULT_NAS = 'http://192.168.10.103:3131';
let nasUrl = DEFAULT_NAS;

async function init() {
  const stored = await chrome.storage.local.get(['nasUrl']);
  nasUrl = stored.nasUrl || DEFAULT_NAS;
  document.getElementById('nasUrl').value = nasUrl;
  document.getElementById('libraryLink').href = nasUrl;
  await checkConnection();
  await checkPage();
}

async function checkConnection() {
  const badge = document.getElementById('statusBadge');
  try {
    const r = await fetch(`${nasUrl}/health`, { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      badge.textContent = '● Online';
      badge.className = 'status';
    } else throw new Error();
  } catch {
    badge.textContent = '● Offline';
    badge.className = 'status offline';
  }
}

async function checkPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const info = document.getElementById('pageInfo');
  const btn = document.getElementById('saveBtn');
  if (!tab.url?.includes('linkedin.com')) {
    info.textContent = '⚠️ Navigate to a LinkedIn post to save it.';
    btn.disabled = true;
  } else {
    info.textContent = '✓ LinkedIn page detected. Click to save.';
    btn.disabled = false;
  }
}

async function savePost() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  showMsg('Extracting post content...', 'info');

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractLinkedInPost
    });

    const postData = results[0].result;
    if (!postData || !postData.content) {
      showMsg('Could not extract post content. Make sure the post is fully loaded.', 'error');
      btn.disabled = false;
      btn.textContent = '📌 Save This Post to Library';
      return;
    }

    const r = await fetch(`${nasUrl}/api/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...postData, url: tab.url })
    });

    const data = await r.json();
    if (data.duplicate) {
      showMsg('Already in your library!', 'info');
    } else if (data.success) {
      showMsg('Saved! AI will tag it in the background 🎉', 'success');
    } else {
      showMsg(data.error || 'Unknown error', 'error');
    }
  } catch (e) {
    showMsg('Cannot reach SavedAndSorted. Check NAS address below.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '📌 Save This Post to Library';
  }
}

function extractLinkedInPost() {
  function getText(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el?.innerText?.trim()) return el.innerText.trim();
    }
    return '';
  }
  const author = getText(['.feed-shared-actor__name', '.update-components-actor__name']);
  const authorTitle = getText(['.feed-shared-actor__description', '.update-components-actor__description']);
  const contentEl = document.querySelector([
    '.feed-shared-update-v2__description',
    '.feed-shared-text',
    '.update-components-text'
  ].join(', '));
  const content = contentEl ? contentEl.innerText.trim() : document.body.innerText.slice(0, 3000);
  return { content, author_name: author, author_title: authorTitle };
}

async function saveSettings() {
  nasUrl = document.getElementById('nasUrl').value.trim().replace(/\/$/, '');
  await chrome.storage.local.set({ nasUrl });
  document.getElementById('libraryLink').href = nasUrl;
  showMsg('Settings saved!', 'success');
  await checkConnection();
}

function showMsg(text, type) {
  const el = document.getElementById('msg');
  el.textContent = text;
  el.className = `msg ${type}`;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('saveBtn').addEventListener('click', savePost);
  document.getElementById('settingsBtn').addEventListener('click', saveSettings);
  init();
});
