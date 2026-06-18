const EXT_NAME = 'maoxiang-tts';

const DEFAULT_SETTINGS = {
    enabled: false,
    ttsUrl: 'wss://audio5-normal-hl.myparallelstory.com/internal/api/v1/ws',
    appkey: 'WQuVLKMGRo',
    defaultVoice: 'ICL_5561786db01b',
    format: 'mp3',
    llmUrl: 'https://api.openai.com/v1',
    llmKey: '',
    llmModel: 'gpt-4o-mini',
    llmPrompt: '',
    voiceMap: '',
};

let eventSource, event_types, getContext, extension_settings, saveSettingsDebounced;

// 等酒馆环境加载完成
jQuery(async () => {
    const ctx = SillyTavern?.getContext?.() || window;

    eventSource = ctx.eventSource;
    event_types = ctx.event_types;
    getContext = ctx.getContext;
    extension_settings = ctx.extension_settings;
    saveSettingsDebounced = ctx.saveSettingsDebounced;

    loadSettings();
    initTabs();

    $('#mxtts-save-basic').on('click', saveBasic);
    $('#mxtts-save-llm').on('click', saveLLM);
    $('#mxtts-save-voices').on('click', saveVoices);

    eventSource?.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource?.on(event_types.MESSAGE_UPDATED, onMessageReceived);

    console.log('[MaoXiangTTS] loaded');
});

function loadSettings() {
    extension_settings[EXT_NAME] = Object.assign(
        {},
        DEFAULT_SETTINGS,
        extension_settings[EXT_NAME] || {}
    );

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

function initTabs() {
    $(document).on('click', '.mxtts-tab-btn', function () {
        $('.mxtts-tab-btn').removeClass('active');
        $(this).addClass('active');

        const tab = $(this).data('tab');

        $('.mxtts-tab').hide();
        $(`#mxtts-tab-${tab}`).show();
    });
}

// 保存
function saveBasic() {
    const s = extension_settings[EXT_NAME];
    s.enabled = $('#mxtts-enabled').prop('checked');
    s.ttsUrl = $('#mxtts-tts-url').val();
    s.appkey = $('#mxtts-appkey').val();
    s.defaultVoice = $('#mxtts-default-voice').val();
    s.format = $('#mxtts-format').val();
    saveSettingsDebounced();
}

function saveLLM() {
    const s = extension_settings[EXT_NAME];
    s.llmUrl = $('#mxtts-llm-url').val();
    s.llmKey = $('#mxtts-llm-key').val();
    s.llmModel = $('#mxtts-llm-model').val();
    s.llmPrompt = $('#mxtts-llm-prompt').val();
    saveSettingsDebounced();
}

function saveVoices() {
    extension_settings[EXT_NAME].voiceMap = $('#mxtts-voice-map').val();
    saveSettingsDebounced();
}

// ===== 消息入口（先留着不动）=====
async function onMessageReceived(msgIdx) {
    const s = extension_settings[EXT_NAME];
    if (!s.enabled) return;

    const ctx = getContext?.();
    const msg = ctx?.chat?.[msgIdx];
    if (!msg || msg.is_user) return;

    console.log('[MaoXiangTTS] message:', msg.mes);
}
