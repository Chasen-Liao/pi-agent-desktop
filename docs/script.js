const year = document.querySelector("#year");
if (year) {
  year.textContent = String(new Date().getFullYear());
}

const commands = document.querySelectorAll("[data-copy]");
for (const command of commands) {
  command.addEventListener("click", async () => {
    const value = command.getAttribute("data-copy");
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      command.classList.add("copied");
      const label = command.querySelector("small");
      if (label) label.textContent = "copied";

      window.setTimeout(() => {
        command.classList.remove("copied");
        if (label) label.textContent = "copy";
      }, 1400);
    } catch {
      const label = command.querySelector("small");
      if (label) label.textContent = "select";
    }
  });
}
