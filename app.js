/* Public pointer only: no platform data, credential input, or automatic navigation. */
(function () {
  "use strict";

  function isAllowedTunnelUrl(value) {
    return typeof value === "string" && value === value.trim() &&
      /^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/?$/.test(value);
  }

  function isTimestamp(value) {
    if (value === null) return true;
    if (typeof value !== "string" || value !== value.trim()) return false;
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
    if (!parts) return false;
    const year = Number(parts[1]);
    const month = Number(parts[2]);
    const day = Number(parts[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
      Number(parts[4]) < 24 && Number(parts[5]) < 60 && Number(parts[6]) < 60 &&
      (!parts[8] || (Number(parts[9]) < 24 && Number(parts[10]) < 60)) &&
      Number.isFinite(Date.parse(value));
  }

  function validateStatus(raw) {
    const expected = ["schema_version", "state", "updated_at", "url"];
    const validShape = raw && typeof raw === "object" && !Array.isArray(raw) &&
      Object.keys(raw).sort().join(",") === expected.join(",");
    if (!validShape || raw.schema_version !== 1 || !isTimestamp(raw.updated_at) ||
        !["offline", "ready"].includes(raw.state) ||
        (raw.state === "offline" ? raw.url !== null : !isAllowedTunnelUrl(raw.url))) {
      throw new Error("入口状态无效，请联系管理员重新发布。");
    }
    return {schema_version: 1, state: raw.state, url: raw.url, updated_at: raw.updated_at};
  }

  function startPortal(doc, runtime) {
    const panel = doc.getElementById("status-panel");
    const label = doc.getElementById("status-label");
    const message = doc.getElementById("status-message");
    const entry = doc.getElementById("entry-link");
    const published = doc.getElementById("published-at");
    const refreshButton = doc.getElementById("refresh-button");
    let busy = false;
    let serial = 0;

    function disableEntry() {
      entry.removeAttribute("href");
      entry.setAttribute("aria-disabled", "true");
      entry.setAttribute("tabindex", "-1");
    }

    function showUnavailable(state, heading, explanation) {
      disableEntry();
      panel.setAttribute("data-state", state);
      label.textContent = heading;
      message.textContent = explanation;
      published.textContent = "本次未取得有效发布日期";
      published.removeAttribute("datetime");
    }

    function showStatus(status) {
      panel.setAttribute("data-state", status.state);
      if (status.updated_at) {
        published.textContent = new Date(status.updated_at).toLocaleString("zh-CN", {hour12: false}) + "（本地时区）";
        published.setAttribute("datetime", status.updated_at);
      } else {
        published.textContent = "未提供";
        published.removeAttribute("datetime");
      }
      if (status.state === "ready") {
        label.textContent = "地址已发布";
        message.textContent = "地址已发布，进入后验证连接。若目标页面打不开，请联系管理员检查主控电脑和通道。";
        entry.setAttribute("href", status.url);
        entry.setAttribute("aria-disabled", "false");
        entry.removeAttribute("tabindex");
      } else {
        disableEntry();
        label.textContent = "暂未开放";
        message.textContent = "当前未发布访问地址。本机离线或通道尚未开启，请联系管理员。";
      }
    }

    async function refresh() {
      if (busy) return;
      busy = true;
      refreshButton.disabled = true;
      refreshButton.textContent = "正在读取…";
      disableEntry();
      panel.setAttribute("aria-busy", "true");
      let timeout;
      try {
        const controller = new runtime.AbortController();
        timeout = runtime.setTimeout(() => controller.abort(), 8000);
        const statusUrl = new URL("status.json", doc.baseURI);
        statusUrl.searchParams.set("v", `${Date.now()}-${++serial}`);
        const response = await runtime.fetch(statusUrl.toString(), {
          cache: "no-store", mode: "same-origin", credentials: "omit", redirect: "error",
          headers: {Accept: "application/json"}, signal: controller.signal
        });
        if (!response.ok) throw new Error("Status read failed");
        let status;
        try {
          status = validateStatus(await response.json());
        } catch (_) {
          showUnavailable("invalid", "状态信息无效", "入口状态格式或地址无效，已停用进入按钮。请联系管理员重新发布。");
          return;
        }
        showStatus(status);
      } catch (_) {
        showUnavailable("error", "状态读取失败", "未能读取入口状态，已停用旧地址。请刷新重试，或联系管理员确认入口和网络。");
      } finally {
        if (timeout !== undefined) runtime.clearTimeout(timeout);
        busy = false;
        refreshButton.disabled = false;
        refreshButton.textContent = "刷新入口状态";
        panel.setAttribute("aria-busy", "false");
      }
    }

    entry.addEventListener("click", event => {
      if (entry.getAttribute("aria-disabled") === "true") event.preventDefault();
    });
    refreshButton.addEventListener("click", refresh);
    refresh();
    const interval = runtime.setInterval(refresh, 30000);
    return {refresh, stop: () => runtime.clearInterval(interval)};
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {isAllowedTunnelUrl, validateStatus, startPortal};
  }
  if (typeof document !== "undefined") startPortal(document, globalThis);
}());
