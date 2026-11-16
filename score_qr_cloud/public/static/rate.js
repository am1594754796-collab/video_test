(() => {
  const cfgEl = document.getElementById("rate-config");
  const form = document.getElementById("rate-form");
  const track = document.getElementById("pick-track");
  const dots = Array.from(document.querySelectorAll("#pick-dots .dot"));
  const slides = Array.from(document.querySelectorAll("#pick-track .pick"));
  const slotInput = document.getElementById("slot-input");
  const scoreInput = document.getElementById("score");
  const commentInput = document.getElementById("comment");
  const currentLabel = document.getElementById("current-label");
  const noticeEl = document.getElementById("rate-notice");
  const errorEl = document.getElementById("rate-error");
  if (!cfgEl || !form || !track || !slides.length) return;

  const cfg = JSON.parse(cfgEl.textContent);
  const slots = cfg.slots || [];
  const scored = new Set((cfg.scoredSlots || []).map(Number));
  let index = Math.max(
    0,
    slots.findIndex((slot) => Number(slot.slot) === Number(cfg.currentSlot)),
  );
  if (index < 0) index = 0;

  const cardHeight = () => slides[0]?.offsetHeight || 160;

  const setMessage = (notice, error) => {
    if (noticeEl) {
      noticeEl.textContent = notice || "";
      noticeEl.hidden = !notice;
    }
    if (errorEl) {
      errorEl.textContent = error || "";
      errorEl.hidden = !error;
    }
  };

  const paint = (smooth) => {
    const offset = Math.max(0, (track.parentElement.clientHeight - cardHeight()) / 2);
    track.style.transition = smooth ? "transform 0.45s ease" : "none";
    track.style.transform = `translateY(${offset - index * cardHeight()}px)`;

    slides.forEach((slide, i) => {
      const slot = Number(slide.dataset.slot);
      const done = scored.has(slot);
      const active = i === index;
      slide.classList.toggle("done", done);
      slide.classList.toggle("active", active);
      slide.classList.toggle("locked", !done && !active);
      const hint = slide.querySelector(".pick-hint");
      if (hint) hint.textContent = done ? "已评分" : active ? "请打分" : "请先完成前面的";
    });

    dots.forEach((dot, i) => {
      const slot = Number(slots[i]?.slot);
      const done = scored.has(slot);
      const on = i === index;
      dot.classList.toggle("done", done);
      dot.classList.toggle("on", on);
    });

    const current = slots[index];
    if (current && slotInput) slotInput.value = String(current.slot);
    if (current && currentLabel) {
      currentLabel.textContent = `当前：${current.name}（${index + 1}/${slots.length}）`;
    }
  };

  const goAllDone = () => {
    document.body.innerHTML =
      '<main style="font-family:sans-serif;text-align:center;padding:48px 16px;color:#17212b"><h1>六人已全部评完</h1><p>感谢参与，每人只能评一次</p></main>';
  };

  paint(false);
  window.addEventListener("resize", () => paint(false));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("", "");
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      const body = new FormData(form);
      body.set("ajax", "1");
      const response = await fetch(form.action || window.location.pathname, {
        method: "POST",
        body,
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        setMessage("", data.error || "提交失败，请重试");
        return;
      }
      if (data.scoredSlot != null) scored.add(Number(data.scoredSlot));
      if (data.done) {
        goAllDone();
        return;
      }
      const nextIndex = slots.findIndex((slot) => Number(slot.slot) === Number(data.nextSlot));
      if (nextIndex < 0) {
        goAllDone();
        return;
      }
      index = nextIndex;
      if (scoreInput) scoreInput.value = "";
      if (commentInput) commentInput.value = "";
      setMessage(data.notice || "", "");
      paint(true);
      if (scoreInput) scoreInput.focus();
    } catch {
      setMessage("", "网络异常，请重试");
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
})();
