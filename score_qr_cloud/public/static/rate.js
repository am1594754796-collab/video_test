(() => {
  const list = document.getElementById("person-list");
  const noticeEl = document.getElementById("rate-notice");
  const errorEl = document.getElementById("rate-error");
  if (!list) return;

  const setGlobal = (notice, error) => {
    if (noticeEl) {
      noticeEl.textContent = notice || "";
      noticeEl.hidden = !notice;
    }
    if (errorEl) {
      errorEl.textContent = error || "";
      errorEl.hidden = !error;
    }
  };

  const markDone = (slot, message) => {
    const article = document.getElementById(`person-${slot}`);
    if (!article) return;
    article.classList.add("done");
    article.innerHTML = `
      <div class="person-head">
        <span class="pick-num">#${slot}</span>
        <span class="pick-name">${article.querySelector(".pick-name")?.textContent || ""}</span>
      </div>
      <p class="done-text">${message || "已提交，不能再次评分"}</p>
    `;
  };

  const remainingOpen = () => list.querySelectorAll(".person-form").length;

  list.querySelectorAll(".person-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const slot = form.getAttribute("data-slot");
      const msg = form.querySelector(".row-msg");
      const button = form.querySelector('button[type="submit"]');
      if (msg) {
        msg.hidden = true;
        msg.textContent = "";
        msg.classList.remove("ok", "err");
      }
      setGlobal("", "");
      if (button) button.disabled = true;
      try {
        const body = new FormData(form);
        body.set("ajax", "1");
        const response = await fetch(window.location.pathname, {
          method: "POST",
          body,
          headers: { Accept: "application/json" },
          credentials: "same-origin",
        });
        const data = await response.json();
        if (!response.ok || data.error) {
          const text = data.error || "提交失败，请重试";
          if (data.already || response.status === 409) {
            markDone(slot, "已提交，不能再次评分");
            setGlobal("", text);
          } else if (msg) {
            msg.hidden = false;
            msg.classList.add("err");
            msg.textContent = text;
          } else {
            setGlobal("", text);
          }
          return;
        }
        markDone(data.scoredSlot || slot, "已提交，不能再次评分");
        setGlobal(data.notice || "提交成功", "");
        if (data.done || remainingOpen() === 0) {
          setGlobal("已全部评完，感谢参与", "");
        }
      } catch {
        if (msg) {
          msg.hidden = false;
          msg.classList.add("err");
          msg.textContent = "网络异常，请重试";
        } else {
          setGlobal("", "网络异常，请重试");
        }
      } finally {
        if (button && form.isConnected) button.disabled = false;
      }
    });
  });
})();
