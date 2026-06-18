// 猫箱TTS情绪增强插件 - 兼容版（无ES module import）
(function () {
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

    // ── 获取酒馆全局对象 ──────────────────────────────
    function getST() {
        // 兼容原版和魔改版的全局挂载方式
        return window.SillyTavern || window;
    }

    function getExtensionSettings() {
        const st = getST();
        if (st.extension_settings) return st.extension_settings;
        if (window.extension_settings) return window.extension_settings;
        return null;
    }

    function getEventSource() {
        const st = getST();
        if (st.eventSource) return st.eventSource;
        if (window.eventSource) return window.eventSource;
        return null;
    }

    function getEventTypes() {
        const st = getST();
        if (st.event_types) return st.event_types;
        if (window.event_types) return window.event_types;
        return { MESSAGE_RECEIVED: 'message_received', MESSAGE_UPDATED: 'message_updated' };
    }

    function getContext() {
        const st = getST();
        if (typeof st.getContext === 'function') return st.getContext();
        if (typeof window.getContext === 'function') return window.getContext();
        return {};
    }

    function saveSettings() {
        const st = getST();
        if (typeof st.saveSettingsDebounced === 'function') st.saveSettingsDebounced();
        else if (typeof window.saveSettingsDebounced === 'function') window.saveSettingsDebounced();
    }

    // ── 初始化设置 ────────────────────────────────────
    function initSettings() {
        const extSettings = getExtensionSettings();
        if (!extSettings) {
            console.warn('[MaoXiangTTS] 无法获取 extension_settings');
            return;
        }
        if (!extSettings[EXT_NAME]) extSettings[EXT_NAME] = {};
        Object.keys(DEFAULT_SETTINGS).forEach(k => {
            if (typeof extSettings[EXT_NAME][k] === 'undefined') {
                extSettings[EXT_NAME][k] = DEFAULT_SETTINGS[k];
            }
        });
    }

    function S() {
        const extSettings = getExtensionSettings();
        return extSettings ? extSettings[EXT_NAME] : DEFAULT_SETTINGS;
    }

    // ── UI 绑定 ───────────────────────────────────────
    function loadUI() {
        const s = S();
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
        const s = S();
        s.enabled = $('#mxtts-enabled').prop('checked');
        s.ttsUrl = $('#mxtts-tts-url').val().trim();
        s.appkey = $('#mxtts-appkey').val().trim();
        s.defaultVoice = $('#mxtts-default-voice').val().trim();
        s.format = $('#mxtts-format').val();
        saveSettings();
        flash('#mxtts-save-basic-msg');
    }

    function saveLLM() {
        const s = S();
        s.llmUrl = $('#mxtts-llm-url').val().trim();
        s.llmKey = $('#mxtts-llm-key').val().trim();
        s.llmModel = $('#mxtts-llm-model').val().trim();
        s.llmPrompt = $('#mxtts-llm-prompt').val();
        saveSettings();
        flash('#mxtts-save-llm-msg');
    }

    function saveVoices() {
        S().voiceMap = $('#mxtts-voice-map').val();
        saveSettings();
        flash('#mxtts-save-voices-msg');
    }

    function flash(sel) {
        $(sel).text('已保存');
        setTimeout(() => $(sel).text(''), 2000);
    }

    function initTabs() {
        $(document).on('click', '.mxtts-tab-btn', function () {
            $('.mxtts-tab-btn').removeClass('active');
            $(this).addClass('active');
            $('.mxtts-tab').hide();
            $('#mxtts-tab-' + $(this).data('tab')).show();
        });
        $('#mxtts-save-basic').on('click', saveBasic);
        $('#mxtts-save-llm').on('click', saveLLM);
        $('#mxtts-save-voices').on('click', saveVoices);
    }

    // ── 角色音色映射 ──────────────────────────────────
    function getVoiceForChar(charName) {
        const raw = S().voiceMap || '';
        const map = {};
        raw.split('\n').forEach(line => {
            const idx = line.indexOf(':');
            if (idx < 1) return;
            map[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        });
        for (const [k, v] of Object.entries(map)) {
            if (charName && charName.includes(k)) return v;
        }
        return S().defaultVoice;
    }

    // ── LLM 情绪标签注入 ──────────────────────────────
    async function injectEmotionTags(text) {
        const s = S();
        if (!s.llmKey || !s.llmUrl || !s.llmModel) return text;
        const prompt = s.llmPrompt.replace('{text}', text);
        try {
            const res = await fetch(s.llmUrl.replace(/\/$/, '') + '/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + s.llmKey,
                },
                body: JSON.stringify({
                    model: s.llmModel,
                    max_tokens: 1024,
                    temperature: 0.3,
                    messages: [{ role: 'user', content: prompt }],
                }),
            });
            const data = await res.json();
            return data?.choices?.[0]?.message?.content?.trim() || text;
        } catch (e) {
            console.warn('[MaoXiangTTS] LLM调用失败:', e);
            return text;
        }
    }

    // ── WebSocket TTS ─────────────────────────────────
    function genId() {
        return String(Math.floor(1e12 + 9e12 * Math.random()));
    }

    function sendTTS(text, voiceId) {
        return new Promise((resolve, reject) => {
            const s = S();
            const url = s.ttsUrl + '?ssmix=&aid=' + genId() + '&device_id=' + genId();
            const ws = new WebSocket(url);
            const chunks = [];
            let timer = setTimeout(() => { ws.close(); reject(new Error('超时')); }, 15000);

            ws.onopen = () => {
                ws.send(JSON.stringify({
                    appkey: s.appkey,
                    event: 'StartTask',
                    namespace: 'BidirectionalTTS',
                    payload: JSON.stringify({
                        speaker: voiceId,
                        audio_config: { format: s.format, sample_rate: s.sampleRate },
                        extra: {
                            post_process: { pitch: 0, speech_rate: 1.0 },
                            max_length_to_filter_parenthesis: 0,
                        },
                    }),
                }));
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
                if (!chunks.length) { reject(new Error('无音频数据')); return; }
                const total = chunks.reduce((n, c) => n + c.length, 0);
                const merged = new Uint8Array(total);
                let off = 0;
                chunks.forEach(c => { merged.set(c, off); off += c.length; });
                resolve(new Blob([merged], { type: s.format === 'mp3' ? 'audio/mpeg' : 'audio/wav' }));
            };

            ws.onerror = (e) => { clearTimeout(timer); reject(e); };
        });
    }

    // ── 播放 ──────────────────────────────────────────
    let currentAudio = null;
    function playBlob(blob) {
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
        const url = URL.createObjectURL(blob);
        currentAudio = new Audio(url);
        currentAudio.onended = () => URL.revokeObjectURL(url);
        currentAudio.play().catch(e => console.error('[MaoXiangTTS] 播放失败:', e));
    }

    // ── 主流程 ────────────────────────────────────────
    async function onMessage(msgIdx) {
        if (!S().enabled) return;
        const ctx = getContext();
        const msg = ctx.chat?.[msgIdx];
        if (!msg || msg.is_user) return;
        const rawText = (msg.mes || '').trim();
        if (!rawText) return;
        const charName = msg.name || ctx.name2 || '';
        try {
            const tagged = await injectEmotionTags(rawText);
            console.log('[MaoXiangTTS] 标注后:', tagged);
            const blob = await sendTTS(tagged, getVoiceForChar(charName));
            playBlob(blob);
        } catch (e) {
            console.error('[MaoXiangTTS] 错误:', e);
        }
    }

    // ── 入口 ──────────────────────────────────────────
    jQuery(async () => {
        initSettings();
        loadUI();
        initTabs();

        const es = getEventSource();
        const et = getEventTypes();
        if (es) {
            es.on(et.MESSAGE_RECEIVED, onMessage);
            es.on(et.MESSAGE_UPDATED, onMessage);
            console.log('[MaoXiangTTS] 插件加载成功');
        } else {
            console.warn('[MaoXiangTTS] 未找到 eventSource，尝试延迟绑定');
            setTimeout(() => {
                const es2 = getEventSource();
                if (es2) {
                    es2.on(et.MESSAGE_RECEIVED, onMessage);
                    es2.on(et.MESSAGE_UPDATED, onMessage);
                    console.log('[MaoXiangTTS] 延迟绑定成功');
                }
            }, 3000);
        }
    });
})();
