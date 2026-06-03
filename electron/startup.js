(function () {
  var params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  var state = params.get("state");
  var message = params.get("message");
  var title = document.getElementById("title");
  var description = document.getElementById("description");
  var stateText = document.getElementById("stateText");
  var panel = document.getElementById("panel");

  if (!title || !description || !stateText || !panel) return;

  if (state === "error") {
    document.title = "启动失败";
    title.textContent = "启动失败";
    description.textContent = "本地服务没有正常启动。请重启应用；如果问题仍然存在，请查看应用日志。";
    stateText.textContent = message || "后端服务不可用";
    panel.classList.add("error");
  } else if (state === "stopped") {
    document.title = "后端服务已停止";
    title.textContent = "后端服务已停止";
    description.textContent = "Pi Agent Desktop 的本地服务异常退出。请重启应用以恢复使用。";
    stateText.textContent = message || "服务进程已退出";
    panel.classList.add("stopped");
  }
})();
