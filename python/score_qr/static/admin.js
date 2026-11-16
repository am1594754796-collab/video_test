const clearScores = document.getElementById("clear-scores");
if (clearScores) {
  clearScores.addEventListener("submit", (event) => {
    if (!window.confirm("确定清空全部评分吗？所有编号的历史评分将被删除，且无法撤销。")) {
      event.preventDefault();
    }
  });
}
