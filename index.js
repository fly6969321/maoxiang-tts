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
    // 模糊匹配：角色名包含关键词即可
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
        console.warn('[MaoXiangTTS] LLM调用失败，使用原文:', e);
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
        let taskStarted = false;

        ws.onopen = () => {
            const startMsg = {
                appkey: s.appkey,
                event: 'StartTask',
                namespace: 'BidirectionalTTS',
                payload: JSON.stringify({
                    speaker: voiceId,
                    audio_config: {
                        format: s.format,
                        sample_rate: 24000,
                    },
                    extra: {
                        post_process: { pitch: 0, speech_rate: 1.0 },
                        max_length_to_filter_parenthesis: 0,
                    },
                }),
            };
            ws.send(JSON.stringify(startMsg));
        };

        ws.onmessage = (evt) => {
            if (typeof evt.data === 'string') {
                try {
                    const msg = JSON.parse(evt.data);
                    if (msg.event === 'TaskStarted') {
                        // 发送文本
                        ws.send(JSON.stringify({ payload: JSON.stringify({ text }) }));
                        // 结束任务
                        ws.send(JSON.stringify({ appkey: s.appkey, event: 'FinishTask', namespace: 'BidirectionalTTS' }));
                        taskStarted = true;
                    } else if (msg.event === 'TaskFinished') {
                        ws.close();
                    } else if (msg.type === 3 && msg.buffer) {
                        // base64音频数据
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
    if (!msg || msg.is_user) return; // 只处理角色消息

    const charName = msg.name || ctx.name2 || '';
    const rawText = msg.mes || '';
    if (!rawText.trim()) return;

    try {
        // 1. LLM注入情绪标签
        const taggedText = await injectEmotionTags(rawText);
        console.log(`[MaoXiangTTS] ${charName} → 标注后文本:`, taggedText);

        // 2. 查角色对应voice_id
        const voiceId = getVoiceForChar(charName);

        // 3. 发给豆包TTS合成
        const blob = await sendTTS(taggedText, voiceId);

        // 4. 播放
        await playBlob(blob);
    } catch (e) {
        console.error('[MaoXiangTTS] 出错:', e);
    }
}

// ── 入口 ─────────────────────────────────────────────
jQuery(async () => {
    try {
        // 动态获取当前扩展的目录路径（最稳妥的方法）
        const settingsHtml = await fetch('./scripts/extensions/third-party/maoxiang-tts/settings.html')
            .then(response => response.text());
        
        // 插入到扩展设置面板中
        $('#extensions_settings').append(settingsHtml);
        console.log('[MaoXiangTTS] settings.html 已加载');
    } catch (e) {
        console.error('[MaoXiangTTS] settings.html 加载失败:', e);
        return; // 如果没加载成功，后面的代码会报错，所以直接返回
    }

    // 2. 再初始化控件
    loadSettings();
    initTabs();

    $('#mxtts-save-basic').on('click', saveBasic);
    $('#mxtts-save-llm').on('click', saveLLM);
    $('#mxtts-save-voices').on('click', saveVoices);

    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.MESSAGE_UPDATED, onMessageReceived);

    console.log('[MaoXiangTTS] 插件加载完成');
});
