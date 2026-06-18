const EXT_NAME = "maoxiang-tts";

function init() {
    const s = window.extension_settings;

    if (!s[EXT_NAME]) {
        s[EXT_NAME] = {};
    }

    loadUI();
}

async function loadUI() {

    const html = await $.get(
        "scripts/extensions/third-party/maoxiang-tts/settings.html"
    );

    const container = $("#extensions_settings");

    container.append(html);

    bindUI();
    renderUI();

    console.log("[MaoXiangTTS] UI loaded");
}

function getSettings() {
    return window.extension_settings[EXT_NAME];
}

function renderUI() {
    const s = getSettings();

    $("#mxtts-enabled").prop("checked", s.enabled);
    $("#mxtts-tts-url").val(s.ttsUrl);
    $("#mxtts-appkey").val(s.appkey);
    $("#mxtts-default-voice").val(s.defaultVoice);
    $("#mxtts-format").val(s.format);
}

function bindUI() {

    $("#mxtts-save").on("click", () => {

        const s = getSettings();

        s.enabled = $("#mxtts-enabled").prop("checked");
        s.ttsUrl = $("#mxtts-tts-url").val();
        s.appkey = $("#mxtts-appkey").val();
        s.defaultVoice = $("#mxtts-default-voice").val();
        s.format = $("#mxtts-format").val();

        window.saveSettingsDebounced();

        $("#mxtts-msg").text("已保存");

        setTimeout(() => {
            $("#mxtts-msg").text("");
        }, 1500);
    });
}

init();
