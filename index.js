const EXT_NAME = "maoxiang-tts";

/**
 * 兼容 1.18：动态从全局获取（避免 import 路径炸掉）
 */
function getLib() {
    return {
        extension_settings: window.extension_settings,
        saveSettingsDebounced: window.saveSettingsDebounced
    };
}

/**
 * 默认配置
 */
const DEFAULT_SETTINGS = {
    enabled: false,
    ttsUrl: "",
    appkey: "",
    defaultVoice: "",
    format: "mp3",
    llmUrl: "",
    llmKey: "",
    llmModel: "",
    voiceMap: ""
};

/**
 * 初始化设置
 */
function initSettings() {
    const { extension_settings } = getLib();

    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = {};
    }

    Object.assign(
        extension_settings[EXT_NAME],
        DEFAULT_SETTINGS,
        extension_settings[EXT_NAME]
    );
}

/**
 * 加载 UI
 */
async function loadUI() {
    const html = await $.get(
        "scripts/extensions/third-party/maoxiang-tts/settings.html"
    );

    $("#extensions_settings").append(html);

    bindUI();
    renderUI();
}

/**
 * 渲染 UI
 */
function renderUI() {
    const { extension_settings } = getLib();
    const s = extension_settings[EXT_NAME];

    $("#mxtts-enabled").prop("checked", s.enabled);
    $("#mxtts-tts-url").val(s.ttsUrl);
    $("#mxtts-appkey").val(s.appkey);
    $("#mxtts-default-voice").val(s.defaultVoice);
    $("#mxtts-format").val(s.format);

    $("#mxtts-llm-url").val(s.llmUrl);
    $("#mxtts-llm-key").val(s.llmKey);
    $("#mxtts-llm-model").val(s.llmModel);

    $("#mxtts-voice-map").val(s.voiceMap);
}

/**
 * 绑定事件
 */
function bindUI() {
    const { extension_settings, saveSettingsDebounced } = getLib();

    $("#mxtts-save").on("click", () => {

        const s = extension_settings[EXT_NAME];

        s.enabled = $("#mxtts-enabled").prop("checked");
        s.ttsUrl = $("#mxtts-tts-url").val();
        s.appkey = $("#mxtts-appkey").val();
        s.defaultVoice = $("#mxtts-default-voice").val();
        s.format = $("#mxtts-format").val();

        s.llmUrl = $("#mxtts-llm-url").val();
        s.llmKey = $("#mxtts-llm-key").val();
        s.llmModel = $("#mxtts-llm-model").val();

        s.voiceMap = $("#mxtts-voice-map").val();

        saveSettingsDebounced();

        $("#mxtts-msg").text("已保存");

        setTimeout(() => {
            $("#mxtts-msg").text("");
        }, 2000);

    });
}

/**
 * 启动入口
 */
jQuery(async () => {

    initSettings();

    await loadUI();

    console.log("[MaoXiangTTS] loaded OK");

});
