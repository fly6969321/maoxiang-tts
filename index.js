const EXT_NAME = "maoxiang-tts";

/**
 * 安全挂载（兼容源码版 + 扩展版）
 */
(function () {

    function log(...args) {
        console.log("[猫箱TTS]", ...args);
    }

    function getSettings() {
        if (!window.extension_settings) {
            window.extension_settings = {};
        }
        if (!window.extension_settings[EXT_NAME]) {
            window.extension_settings[EXT_NAME] = {};
        }
        return window.extension_settings[EXT_NAME];
    }

    function init() {
        log("开始加载...");

        const s = getSettings();

        // 如果 settings.html 存在，就尝试插入
        if (window.$ && $("#extensions_settings").length) {

            fetch("scripts/extensions/third-party/maoxiang-tts/settings.html")
                .then(r => r.text())
                .then(html => {
                    $("#extensions_settings").append(html);
                    log("UI 已注入");
                    bindUI();
                })
                .catch(err => {
                    log("UI加载失败（但JS正常）", err);
                });

        } else {
            log("未找到UI容器，仅运行逻辑模式");
        }

        log("加载完成 ✔");
    }

    function bindUI() {

        $("#mxtts-save").on("click", () => {

            const s = getSettings();

            s.enabled = $("#mxtts-enabled").prop("checked");
            s.ttsUrl = $("#mxtts-tts-url").val();
            s.appkey = $("#mxtts-appkey").val();
            s.defaultVoice = $("#mxtts-default-voice").val();
            s.format = $("#mxtts-format").val();

            if (window.saveSettingsDebounced) {
                window.saveSettingsDebounced();
            }

            $("#mxtts-msg").text("已保存");

            setTimeout(() => $("#mxtts-msg").text(""), 1500);
        });
    }

    // 🔥 关键：强制挂载执行（避免“没触发入口”问题）
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

})();
