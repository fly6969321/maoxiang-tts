import { eventSource, event_types, getContext } from '../../../../script.js';
import { extension_settings, saveSettingsDebounced } from '../../../extensions.js';

const EXT_NAME = 'maoxiang-tts';

const DEFAULT_SETTINGS = {
    enabled: false,
    ttsUrl: 'wss://audio5-normal-hl.myparallelstory.com/internal/api/v1/ws',
    appkey: 'WQuVLKMGRo',
    defaultVoice: 'ICL_5561786db01b',
    format: 'mp3',
    sampleRate: 24000,
    llmUrl: 'https://api.openai.com/v1',
    llmKey: '',
    llmModel: 'gpt-4o-mini',
    llmPrompt: `你是一个情绪分析助手。请根据下面角色说的话，在每个语气/情绪变化的句子或段落前面，插入一个对应的情绪标签（英文方括号格式，如 [happy]、[sad]）。
只插入标签，不要修改原文任何内容，不要解释，直接输出加了标签的完整文本。
可用标签：[happy][sad][angry][surprised][fear][hate][neutral][excited][gentle][shy][coquettish][teasing][doting][sympathetic][grateful][expectant][playful][relaxed][lazy][wronged][disappointed][jealous][nervous][serious][confused][hesitant][firm][arrogant][humble][sarcastic][contemptuous][tender][lovey-dovey][depressed][guilt][pain][coldness][shout][crazy][whispering][breath][hum]

原文：
{text}`,
    voiceMap: '',
};

// ── 设置初始化 ──────────────────────────────────────────
function loadSettings() {
    extension_settings[EXT_NAME] = Object.assign({}, DEFAULT_SETTINGS, extension_settings[EXT_NAME] || {});
    const s = extension_settings[EXT_NAME];

    $('#mxtts-enabled').prop('checked', s.enabled);
    $('#mxtts-tts-url').val(s.ttsUrl);
    $('#mxtts-appkey').val(s.appkey);
    $('#mxtts-default-voice').val(s.defaultVoice);
    $('#mxtts-format').val(s.format);
    $('#mxtts-llm-url').val(s.llmUrl);
    $('#mxtts-llm-key').val(s.llmKey);
    $('#mxtts-llm-model').val(s.llmModel);
    $('#mxtts-llm-prompt').val(s.llmPrompt);
    $('#mxtts-voice-map').val(s.voiceMap);
}

function saveBasic() {
    const s = extension_settings[EXT_NAME];
    s.enabled = $('#mxtts-enabled').prop('checked');
    s.ttsUrl = $('#mxtts-tts-url').val().trim();
    s.appkey = $('#mxtts-appkey').val().trim();
    s.defaultVoice = $('#mxtts-default-voice').val().trim();
    s.format = $('#mxtts-format').val();
    saveSettingsDebounced();
    flashMsg('#mxtts-save-basic-msg', '已保存');
}

function saveLLM() {
    const s = extension_settings[EXT_NAME];
    s.llmUrl = $('#mxtts-llm-url').val().trim();
    s.llmKey = $('#mxtts-llm-key').val().trim();
    s.llmModel = $('#mxtts-llm-model').val().trim();
    s.llmPrompt = $('#mxtts-llm-prompt').val();
    saveSettingsDebounced();
    flashMsg('#mxtts-save-llm-msg', '已保存');
}

function saveVoices() {
    extension_settings[EXT_NAME].voiceMap = $('#mxtts-voice-map').val();
    saveSettingsDebounced();
    flashMsg('#mxtts-save-voices-msg', '已保存');
}

function flashMsg(selector, text) {
    const el = $(selector);
    el.text(text);
    setTimeout(() => el.text(''), 2000);
}

// ── Tab 切换 ──────────────────────────────────────────
function initTabs() {
    $(document).on('click', '.mxtts-tab-btn', function () {
        $('.mxtts-tab-btn').removeClass('active');
        $(this).addClass('active');
        const tab = $(this).data('tab');
        $('.mxtts-tab').hide();
        $(`#mxtts-tab-${tab}`).show();
    });
}

// ── 解析角色→voice_id 映射表 ──────────────────────────
function getVoiceMap() {
    const raw = extension_settings[EXT_NAME].voiceMap || '';
    const map = {};
    raw.split('\n').forEach(line => {
        const idx = line.indexOf(':');
        if (idx < 1) return;
        const name = line.slice(0, idx).trim();
        const vid = line.slice(idx + 1).trim();
        if (name && vid) map[name] = vid;
    });
    return map;
}

function getVoiceForChar(charName) {
    const map = getVoiceMap();
    for (const [key, vid] of Object.entries(map)) {
        if (charName && charName.includes(key)) return vid;
    }
    return extension_settings[EXT_NAME].defaultVoice;
}

// ── LLM 情绪标签注入 ──────────────────────────────────
async function injectEmotionTags(text) {
    const s = extension_settings[EXT_NAME];
    if (!s.llmKey || !s.llmUrl || !s.llmModel) return text;

    const prompt = s.llmPrompt.replace('{text}', text);
    try {
        const res = await fetch(`${s.llmUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${s.llmKey}`,
            },
            body: JSON.stringify({
                model: s.llmModel,
                max_tokens: 1024,
                temperature: 0.3,
                messages: [{ role: 'user', content: prompt }],
            }),
        });
        const data = await res.json();
        const result = data?.choices?.[0]?.message?.content?.trim();
        return result || text;
    } catch (e) {
        return text;
    }
}

// ── WebSocket TTS 请求 ────────────────────────────────
function generateId() {
    return String(Math.floor(1e12 + 9e12 * Math.random()));
}

function sendTTS(text, voiceId) {
    return new Promise((resolve, reject) => {
        const s = extension_settings[EXT_NAME];
        const aid = generateId();
        const deviceId = generateId();
        const url = `${s.ttsUrl}?ssmix=&aid=${aid}&device_id=${deviceId}`;

        const ws = new WebSocket(url);
        const audioChunks = [];

        ws.onopen = () => {
            const startMsg = {
                appkey: s.appkey,
                event: 'StartTask',
                namespace: 'BidirectionalTTS',
                payload: JSON.stringify({
                    speaker: voiceId,
                    audio_config: { format: s.format, sample_rate: 24000 },
                    extra: { post_process: { pitch: 0, speech_rate: 1.0 }, max_length_to_filter_parenthesis: 0 },
                }),
            };
            ws.send(JSON.stringify(startMsg));
        };

        ws.onmessage = (evt) => {
            if (typeof evt.data === 'string') {
                try {
                    const msg = JSON.parse(evt.data);
                    if (msg.event === 'TaskStarted') {
                        ws.send(JSON.stringify({ payload: JSON.stringify({ text }) }));
                        ws.send(JSON.stringify({ appkey: s.appkey, event: 'FinishTask', namespace: 'BidirectionalTTS' }));
                    } else if (msg.event === 'TaskFinished') {
                        ws.close();
                    } else if (msg.type === 3 && msg.buffer) {
                        const bin = atob(msg.buffer);
                        const arr = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                        audioChunks.push(arr);
                    }
                } catch (e) {}
            } else if (evt.data instanceof ArrayBuffer) {
                audioChunks.push(new Uint8Array(evt.data));
            } else if (evt.data instanceof Blob) {
                evt.data.arrayBuffer().then(buf => audioChunks.push(new Uint8Array(buf)));
            }
        };

        ws.onclose = () => {
            if (audioChunks.length === 0) { reject(new Error('无音频数据')); return; }
            const total = audioChunks.reduce((n, c) => n + c.length, 0);
            const merged = new Uint8Array(total);
            let offset = 0;
            for (const c of audioChunks) { merged.set(c, offset); offset += c.length; }
            const blob = new Blob([merged], { type: s.format === 'mp3' ? 'audio/mpeg' : 'audio/wav' });
            resolve(blob);
        };

        ws.onerror = (e) => reject(e);
        setTimeout(() => { try { ws.close(); } catch(e){} reject(new Error('超时')); }, 15000);
    });
}

// ── 播放音频 blob ─────────────────────────────────────
let currentAudio = null;

async function playBlob(blob) {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
}

// ── 主流程：收到消息后触发 ────────────────────────────
async function onMessageReceived(msgIdx) {
    const s = extension_settings[EXT_NAME];
    if (!s.enabled) return;

    const ctx = getContext();
    const msg = ctx.chat?.[msgIdx];
    if (!msg || msg.is_user) return;

    const charName = msg.name || ctx.name2 || '';
    const rawText = msg.mes || '';
    if (!rawText.trim()) return;

    try {
        const taggedText = await injectEmotionTags(rawText);
        const voiceId = getVoiceForChar(charName);
        const blob = await sendTTS(taggedText, voiceId);
        await playBlob(blob);
    } catch (e) {}
}

// ── 将 HTML 直接内联 ──────────────────────────────────
const SETTINGS_HTML = `
<div id="maoxiang-tts-settings" style="padding:10px;font-size:14px;">
  <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;">
    <button class="mxtts-tab-btn active" data-tab="basic">基础设置</button>
    <button class="mxtts-tab-btn" data-tab="llm">LLM设置</button>
    <button class="mxtts-tab-btn" data-tab="voices">角色音色</button>
  </div>

  <div class="mxtts-tab" id="mxtts-tab-basic">
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
      <input type="checkbox" id="mxtts-enabled"> 启用插件
    </label>
    <label style="display:block;margin-bottom:6px;">TTS Server 地址</label>
    <input id="mxtts-tts-url" type="text" placeholder="wss://..." style="width:100%;margin-bottom:10px;padding:6px;box-sizing:border-box;">
    <label style="display:block;margin-bottom:6px;">appkey</label>
    <input id="mxtts-appkey" type="text" style="width:100%;margin-bottom:10px;padding:6px;box-sizing:border-box;">
    <label style="display:block;margin-bottom:6px;">默认 voice_id</label>
    <input id="mxtts-default-voice" type="text" style="width:100%;margin-bottom:10px;padding:6px;box-sizing:border-box;">
    <label style="display:block;margin-bottom:6px;">音频格式</label>
    <select id="mxtts-format" style="width:100%;margin-bottom:10px;padding:6px;">
      <option value="mp3">MP3</option>
      <option value="pcm">PCM</option>
    </select>
    <button id="mxtts-save-basic" style="padding:6px 16px;">保存</button>
    <span id="mxtts-save-basic-msg" style="margin-left:8px;color:green;font-size:12px;"></span>
  </div>

  <div class="mxtts-tab" id="mxtts-tab-llm" style="display:none;">
    <label style="display:block;margin-bottom:6px;">LLM API Base URL</label>
    <input id="mxtts-llm-url" type="text" placeholder="https://api.openai.com/v1" style="width:100%;margin-bottom:10px;padding:6px;box-sizing:border-box;">
    <label style="display:block;margin-bottom:6px;">API Key</label>
    <input id="mxtts-llm-key" type="password" placeholder="sk-..." style="width:100%;margin-bottom:10px;padding:6px;box-sizing:border-box;">
    <label style="display:block;margin-bottom:6px;">模型名</label>
    <input id="mxtts-llm-model" type="text" style="width:100%;margin-bottom:10px;padding:6px;box-sizing:border-box;">
    <label style="display:block;margin-bottom:6px;">情绪提取 Prompt</label>
    <textarea id="mxtts-llm-prompt" rows="6" style="width:100%;margin-bottom:10px;padding:6px;box-sizing:border-box;font-size:12px;"></textarea>
    <button id="mxtts-save-llm" style="padding:6px 16px;">保存</button>
    <span id="mxtts-save-llm-msg" style="margin-left:8px;color:green;font-size:12px;"></span>
  </div>

  <div class="mxtts-tab" id="mxtts-tab-voices" style="display:none;">
    <div style="font-size:12px;color:#888;margin-bottom:8px;">
      每行一条，格式：角色名:voice_id
    </div>
    <textarea id="mxtts-voice-map" rows="8" style="width:100%;padding:6px;box-sizing:border-box;font-family:monospace;font-size:13px;"></textarea>
    <div style="margin-top:8px;display:flex;gap:8px;">
      <button id="mxtts-save-voices" style="padding:6px 16px;">保存</button>
      <span id="mxtts-save-voices-msg" style="color:green;font-size:12px;align-self:center;"></span>
    </div>
  </div>
</div>

<style>
.mxtts-tab-btn { padding: 5px 12px; border: 1px solid #888; background: transparent; border-radius: 4px; cursor: pointer; font-size: 13px; }
.mxtts-tab-btn.active { background: #7a6a5a; color: #fff; border-color: #7a6a5a; }
#maoxiang-tts-settings input, #maoxiang-tts-settings textarea, #maoxiang-tts-settings select {
  background: var(--SmartThemeBlurTintColor, #2a2a2a);
  color: var(--SmartThemeBodyColor, #eee);
  border: 1px solid #555;
  border-radius: 4px;
}
</style>
`;

// ── 入口 ─────────────────────────────────────────────
jQuery(async () => {
    // 直接把 HTML 拼进去，不依赖外部文件读取
    $('#extensions_settings').append(SETTINGS_HTML);

    loadSettings();
    initTabs();

    $('#mxtts-save-basic').on('click', saveBasic);
    $('#mxtts-save-llm').on('click', saveLLM);
    $('#mxtts-save-voices').on('click', saveVoices);

    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.MESSAGE_UPDATED, onMessageReceived);
});
