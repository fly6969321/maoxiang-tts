/*
 * 猫箱TTS情绪增强插件
 * 通过LLM提取情绪标签，调用豆包TTS合成语音
 */

const MXTTS_NAME = 'maoxiang-tts';
const MXTTS_DEFAULTS = {
    enabled: false,
    ttsUrl: 'wss://audio5-normal-hl.myparallelstory.com/internal/api/v1/ws',
    appkey: 'WQuVLKMGRo',
    defaultVoice: 'ICL_5561786db01b',
    format: 'mp3',
    sampleRate: 24000,
    llmUrl: 'https://api.openai.com/v1',
    llmKey: '',
    llmModel: 'gpt-4o-mini',
    llmPrompt: '你是一个情绪分析助手。根据下面角色说的话，在每个语气/情绪变化的句子前插入对应情绪标签（英文方括号，如 [happy]、[sad]）。只插入标签不修改原文，不解释，直接输出加了标签的完整文本。\n可用标签：[happy][sad][angry][surprised][fear][hate][neutral][excited][gentle][shy][coquettish][teasing][doting][sympathetic][grateful][expectant][playful][relaxed][lazy][wronged][disappointed][jealous][nervous][serious][confused][hesitant][firm][arrogant][humble][sarcastic][contemptuous][tender][lovey-dovey][depressed][guilt][pain][coldness][shout][crazy][whispering][breath][hum]\n原文：\n{text}',
    voiceMap: '',
};

function mxCtx() { return SillyTavern.getContext(); }

function mxSettings() {
    const es = mxCtx().extensionSettings;
    if (!es[MXTTS_NAME]) es[MXTTS_NAME] = {};
    for (const [k, v] of Object.entries(MXTTS_DEFAULTS)) {
        if (es[MXTTS_NAME][k] === undefined) es[MXTTS_NAME][k] = v;
    }
    return es[MXTTS_NAME];
}

function mxSave(key, val) {
    mxCtx().extensionSettings[MXTTS_NAME][key] = val;
    mxCtx().saveSettingsDebounced();
}

// ── 角色音色映射 ──────────────────────────────────────
function mxGetVoice(charName) {
    const map = {};
    (mxSettings().voiceMap || '').split('\n').forEach(line => {
        const i = line.indexOf(':');
        if (i < 1) return;
        map[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    for (const [k, v] of Object.entries(map)) {
        if (charName && charName.includes(k)) return v;
    }
    return mxSettings().defaultVoice;
}

// ── LLM 情绪标签注入 ──────────────────────────────────
async function mxInjectEmotion(text) {
    const s = mxSettings();
    if (!s.llmKey || !s.llmUrl || !s.llmModel) return text;
    try {
        const res = await fetch(s.llmUrl.replace(/\/$/, '') + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + s.llmKey
            },
            body: JSON.stringify({
                model: s.llmModel,
                max_tokens: 1024,
                temperature: 0.3,
                messages: [{ role: 'user', content: s.llmPrompt.replace('{text}', text) }],
            }),
        });
        const d = await res.json();
        return d?.choices?.[0]?.message?.content?.trim() || text;
    } catch (e) {
        console.warn('[MaoXiangTTS] LLM失败:', e);
        return text;
    }
}

// ── WebSocket TTS ─────────────────────────────────────
function mxGenId() { return String(Math.floor(1e12 + 9e12 * Math.random())); }

function mxSendTTS(text, voiceId) {
    const s = mxSettings();
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(s.ttsUrl + '?ssmix=&aid=' + mxGenId() + '&device_id=' + mxGenId());
        const chunks = [];
        const timer = setTimeout(() => { ws.close(); reject(new Error('超时')); }, 15000);

        ws.onopen = () => ws.send(JSON.stringify({
            appkey: s.appkey,
            event: 'StartTask',
            namespace: 'BidirectionalTTS',
            payload: JSON.stringify({
                speaker: voiceId,
                audio_config: { format: s.format, sample_rate: s.sampleRate },
                extra: { post_process: { pitch: 0, speech_rate: 1.0 }, max_length_to_filter_parenthesis: 0 },
            }),
        }));

        ws.onmessage = evt => {
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
                        chunks.push(arr);
                    }
                } catch (e) {}
            } else if (evt.data instanceof ArrayBuffer) {
                chunks.push(new Uint8Array(evt.data));
            } else if (evt.data instanceof Blob) {
                evt.data.arrayBuffer().then(b => chunks.push(new Uint8Array(b)));
            }
        };

        ws.onclose = () => {
            clearTimeout(timer);
            if (!chunks.length) return reject(new Error('无音频数据'));
            const total = chunks.reduce((n, c) => n + c.length, 0);
            const merged = new Uint8Array(total);
            let off = 0;
            chunks.forEach(c => { merged.set(c, off); off += c.length; });
            resolve(new Blob([merged], { type: s.format === 'mp3' ? 'audio/mpeg' : 'audio/wav' }));
        };
        ws.onerror = e => { clearTimeout(timer); reject(e); };
    });
}

// ── 播放 ──────────────────────────────────────────────
let mxCurrentAudio = null;
function mxPlay(blob) {
    if (mxCurrentAudio) { mxCurrentAudio.pause(); mxCurrentAudio = null; }
    const url = URL.createObjectURL(blob);
    mxCurrentAudio = new Audio(url);
    mxCurrentAudio.onended = () => URL.revokeObjectURL(url);
    mxCurrentAudio.play().catch(e => console.error('[MaoXiangTTS] 播放失败:', e));
}

// ── 消息事件处理 ──────────────────────────────────────
async function mxOnMessage(idx) {
    if (!mxSettings().enabled) return;
    const c = mxCtx();
    const msg = c.chat?.[idx];
    if (!msg || msg.is_user) return;
    const text = (msg.mes || '').trim();
    if (!text) return;
    try {
        const tagged = await mxInjectEmotion(text);
        console.log('[MaoXiangTTS] 情绪标注后:', tagged);
        mxPlay(await mxSendTTS(tagged, mxGetVoice(msg.name || c.name2 || '')));
    } catch (e) {
        console.error('[MaoXiangTTS] 错误:', e);
    }
}

// ── 创建UI ────────────────────────────────────────────
function mxCreateUI() {
    const s = mxSettings();
    const html = `
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>🔊 猫箱TTS情绪增强</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="padding:10px;">

            <label class="checkbox_label" style="margin-bottom:12px;">
                <input type="checkbox" id="mxtts-enabled" ${s.enabled ? 'checked' : ''}>
                <span>启用插件</span>
            </label>

            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>基础设置</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <label>TTS Server 地址</label>
                    <input id="mxtts-tts-url" class="text_pole" type="text" value="${s.ttsUrl}" placeholder="wss://...">
                    <label>AppKey</label>
                    <input id="mxtts-appkey" class="text_pole" type="text" value="${s.appkey}">
                    <label>默认 voice_id（无角色匹配时使用）</label>
                    <input id="mxtts-default-voice" class="text_pole" type="text" value="${s.defaultVoice}" placeholder="ICL_5561786db01b">
                    <label>音频格式</label>
                    <select id="mxtts-format" class="text_pole">
                        <option value="mp3" ${s.format === 'mp3' ? 'selected' : ''}>MP3</option>
                        <option value="pcm" ${s.format === 'pcm' ? 'selected' : ''}>PCM</option>
                    </select>
                </div>
            </div>

            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>LLM 设置</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <label>API Base URL</label>
                    <input id="mxtts-llm-url" class="text_pole" type="text" value="${s.llmUrl}" placeholder="https://api.openai.com/v1">
                    <label>API Key</label>
                    <input id="mxtts-llm-key" class="text_pole" type="password" value="${s.llmKey}" placeholder="sk-...">
                    <label>模型名称</label>
                    <input id="mxtts-llm-model" class="text_pole" type="text" value="${s.llmModel}" placeholder="gpt-4o-mini">
                    <label>情绪提取 Prompt（{text} 会替换为原文）</label>
                    <textarea id="mxtts-llm-prompt" class="text_pole" rows="6" style="font-size:12px;">${s.llmPrompt}</textarea>
                    <div style="font-size:11px;opacity:0.6;margin-top:4px;line-height:1.5;">
                        可用标签：[happy][sad][angry][surprised][fear][hate][neutral][excited][gentle][shy][coquettish][teasing][doting][tender][lovey-dovey][wronged][disappointed][depressed][guilt][pain][nervous][serious][confused][firm][arrogant][humble][sarcastic][coldness][shout][crazy][whispering][breath][hum]
                    </div>
                </div>
            </div>

            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>角色音色绑定</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div style="font-size:12px;opacity:0.65;margin-bottom:6px;line-height:1.6;">
                        每行一条，格式：角色名:voice_id<br>例如：小樱:ICL_5561786db01b
                    </div>
                    <textarea id="mxtts-voice-map" class="text_pole" rows="8"
                        style="font-family:monospace;font-size:13px;"
                        placeholder="角色名:voice_id&#10;角色名2:voice_id2">${s.voiceMap}</textarea>
                </div>
            </div>

            <div style="margin-top:12px;display:flex;gap:8px;align-items:center;">
                <input type="button" id="mxtts-save" class="menu_button" value="保存所有设置">
                <span id="mxtts-save-msg" style="font-size:12px;color:green;"></span>
            </div>

        </div>
    </div>`;

    $('#extensions_settings2').append(html);

    // 折叠
    $('.inline-drawer-toggle').off('click.mxtts').on('click.mxtts', function () {
        $(this).parent().toggleClass('inline-drawer-expanded');
    });

    // 保存
    $('#mxtts-save').on('click', () => {
        mxSave('enabled', $('#mxtts-enabled').prop('checked'));
        mxSave('ttsUrl', $('#mxtts-tts-url').val().trim());
        mxSave('appkey', $('#mxtts-appkey').val().trim());
        mxSave('defaultVoice', $('#mxtts-default-voice').val().trim());
        mxSave('format', $('#mxtts-format').val());
        mxSave('llmUrl', $('#mxtts-llm-url').val().trim());
        mxSave('llmKey', $('#mxtts-llm-key').val().trim());
        mxSave('llmModel', $('#mxtts-llm-model').val().trim());
        mxSave('llmPrompt', $('#mxtts-llm-prompt').val());
        mxSave('voiceMap', $('#mxtts-voice-map').val());
        const msg = $('#mxtts-save-msg');
        msg.text('已保存 ✓');
        setTimeout(() => msg.text(''), 2000);
    });
}

// ── 入口：等待SillyTavern就绪 ─────────────────────────
const mxWait = setInterval(() => {
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        const c = SillyTavern.getContext();
        if (c.eventSource && c.event_types && c.event_types.APP_READY) {
            clearInterval(mxWait);
            c.eventSource.on(c.event_types.APP_READY, () => {
                mxSettings(); // 初始化默认值
                mxCreateUI();
                c.eventSource.on(c.event_types.MESSAGE_RECEIVED, mxOnMessage);
                c.eventSource.on(c.event_types.CHARACTER_MESSAGE_RENDERED, mxOnMessage);
                console.log('[MaoXiangTTS] 插件加载成功');
            });
        }
    }
}, 300);
