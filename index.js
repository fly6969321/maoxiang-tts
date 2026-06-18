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
        llmPrompt: '你是一个情绪分析助手。根据下面角色说的话，在每个语气/情绪变化的句子前插入对应情绪标签（英文方括号，如 [happy]、[sad]）。只插入标签不修改原文，不解释，直接输出加了标签的完整文本。\n可用标签：[happy][sad][angry][surprised][fear][hate][neutral][excited][gentle][shy][coquettish][teasing][doting][sympathetic][grateful][expectant][playful][relaxed][lazy][wronged][disappointed][jealous][nervous][serious][confused][hesitant][firm][arrogant][humble][sarcastic][contemptuous][tender][lovey-dovey][depressed][guilt][pain][coldness][shout][crazy][whispering][breath][hum]\n原文：\n{text}',
        voiceMap: '',
    };

    function getSettings() {
        if (!window.extension_settings) return DEFAULT_SETTINGS;
        if (!window.extension_settings[EXT_NAME]) window.extension_settings[EXT_NAME] = {};
        const s = window.extension_settings[EXT_NAME];
        Object.keys(DEFAULT_SETTINGS).forEach(k => {
            if (typeof s[k] === 'undefined') s[k] = DEFAULT_SETTINGS[k];
        });
        return s;
    }

    function saveSettings() {
        if (typeof window.saveSettingsDebounced === 'function') window.saveSettingsDebounced();
    }

    function g(id) { return document.getElementById(id); }

    function flash(id) {
        const el = g(id);
        if (!el) return;
        el.textContent = '已保存 ✓';
        setTimeout(() => { el.textContent = ''; }, 2000);
    }

    function loadUI() {
        const s = getSettings();
        if (g('mxtts-enabled')) g('mxtts-enabled').checked = s.enabled;
        if (g('mxtts-tts-url')) g('mxtts-tts-url').value = s.ttsUrl;
        if (g('mxtts-appkey')) g('mxtts-appkey').value = s.appkey;
        if (g('mxtts-default-voice')) g('mxtts-default-voice').value = s.defaultVoice;
        if (g('mxtts-format')) g('mxtts-format').value = s.format;
        if (g('mxtts-llm-url')) g('mxtts-llm-url').value = s.llmUrl;
        if (g('mxtts-llm-key')) g('mxtts-llm-key').value = s.llmKey;
        if (g('mxtts-llm-model')) g('mxtts-llm-model').value = s.llmModel;
        if (g('mxtts-llm-prompt')) g('mxtts-llm-prompt').value = s.llmPrompt;
        if (g('mxtts-voice-map')) g('mxtts-voice-map').value = s.voiceMap;
    }

    function bindUI() {
        // Tab切换
        document.querySelectorAll('.mxtts-tab').forEach(btn => {
            btn.addEventListener('click', function () {
                const tab = this.dataset.tab;
                ['basic', 'llm', 'voices'].forEach(t => {
                    const el = g('mxtts-tab-' + t);
                    if (el) el.style.display = t === tab ? '' : 'none';
                });
            });
        });

        g('mxtts-save-basic')?.addEventListener('click', () => {
            const s = getSettings();
            s.enabled = g('mxtts-enabled')?.checked || false;
            s.ttsUrl = g('mxtts-tts-url')?.value.trim() || '';
            s.appkey = g('mxtts-appkey')?.value.trim() || '';
            s.defaultVoice = g('mxtts-default-voice')?.value.trim() || '';
            s.format = g('mxtts-format')?.value || 'mp3';
            saveSettings();
            flash('mxtts-save-basic-msg');
        });

        g('mxtts-save-llm')?.addEventListener('click', () => {
            const s = getSettings();
            s.llmUrl = g('mxtts-llm-url')?.value.trim() || '';
            s.llmKey = g('mxtts-llm-key')?.value.trim() || '';
            s.llmModel = g('mxtts-llm-model')?.value.trim() || '';
            s.llmPrompt = g('mxtts-llm-prompt')?.value || '';
            saveSettings();
            flash('mxtts-save-llm-msg');
        });

        g('mxtts-save-voices')?.addEventListener('click', () => {
            getSettings().voiceMap = g('mxtts-voice-map')?.value || '';
            saveSettings();
            flash('mxtts-save-voices-msg');
        });
    }

    function getVoice(charName) {
        const s = getSettings();
        const map = {};
        (s.voiceMap || '').split('\n').forEach(line => {
            const i = line.indexOf(':');
            if (i < 1) return;
            map[line.slice(0, i).trim()] = line.slice(i + 1).trim();
        });
        for (const [k, v] of Object.entries(map)) {
            if (charName && charName.includes(k)) return v;
        }
        return s.defaultVoice;
    }

    async function injectEmotion(text) {
        const s = getSettings();
        if (!s.llmKey || !s.llmUrl || !s.llmModel) return text;
        try {
            const res = await fetch(s.llmUrl.replace(/\/$/, '') + '/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.llmKey },
                body: JSON.stringify({
                    model: s.llmModel, max_tokens: 1024, temperature: 0.3,
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

    function genId() { return String(Math.floor(1e12 + 9e12 * Math.random())); }

    function sendTTS(text, voiceId) {
        const s = getSettings();
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(s.ttsUrl + '?ssmix=&aid=' + genId() + '&device_id=' + genId());
            const chunks = [];
            const timer = setTimeout(() => { ws.close(); reject(new Error('超时')); }, 15000);

            ws.onopen = () => ws.send(JSON.stringify({
                appkey: s.appkey, event: 'StartTask', namespace: 'BidirectionalTTS',
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
                if (!chunks.length) return reject(new Error('无音频'));
                const total = chunks.reduce((n, c) => n + c.length, 0);
                const merged = new Uint8Array(total);
                let off = 0;
                chunks.forEach(c => { merged.set(c, off); off += c.length; });
                resolve(new Blob([merged], { type: s.format === 'mp3' ? 'audio/mpeg' : 'audio/wav' }));
            };
            ws.onerror = e => { clearTimeout(timer); reject(e); };
        });
    }

    let currentAudio = null;
    function play(blob) {
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
        const url = URL.createObjectURL(blob);
        currentAudio = new Audio(url);
        currentAudio.onended = () => URL.revokeObjectURL(url);
        currentAudio.play().catch(e => console.error('[MaoXiangTTS] 播放失败:', e));
    }

    async function onMessage(idx) {
        if (!getSettings().enabled) return;
        const chat = window.chat || (window.getContext && window.getContext().chat);
        if (!chat) return;
        const msg = chat[idx];
        if (!msg || msg.is_user) return;
        const text = (msg.mes || '').trim();
        if (!text) return;
        const charName = msg.name || '';
        try {
            const tagged = await injectEmotion(text);
            console.log('[MaoXiangTTS] 标注后:', tagged);
            play(await sendTTS(tagged, getVoice(charName)));
        } catch (e) {
            console.error('[MaoXiangTTS] 错误:', e);
        }
    }

    jQuery(async () => {
        setTimeout(() => {
            loadUI();
            bindUI();
            const es = window.eventSource;
            const et = window.event_types;
            if (es && et) {
                es.on(et.MESSAGE_RECEIVED, onMessage);
                es.on(et.CHARACTER_MESSAGE_RENDERED, onMessage);
                console.log('[MaoXiangTTS] 插件加载成功');
            } else {
                console.warn('[MaoXiangTTS] eventSource未找到');
            }
        }, 1000);
    });
})();
