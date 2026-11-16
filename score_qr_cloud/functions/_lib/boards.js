export const BOARDS = {
  main: {
    id: "main",
    slotCount: 6,
    defaultTitle: "扫码评分",
    label: "六人评分",
    basePath: "",
  },
  case: {
    id: "case",
    slotCount: 3,
    defaultTitle: "案例打分",
    label: "案例打分",
    basePath: "/case",
  },
};

export function getBoard(id = "main") {
  return BOARDS[id] || BOARDS.main;
}

export function boardPaths(board) {
  const base = board.basePath || "";
  return {
    admin: base || "/",
    rate: `${base}/s`,
    qr: `${base}/qr`,
    codes: `${base}/codes`,
    clear: `${base}/scores/clear`,
    liveApi: `${base}/api/live-scores`,
  };
}

export function rateTitleKey(boardId) {
  return `rate_title:${boardId}`;
}
