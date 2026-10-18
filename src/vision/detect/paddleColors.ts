/**
 * Per-seat raise-paddle colors (left→right seat index 1–6).
 * Seat 1 defaults to white; 2–6 use mutually distant hues.
 */

export type PaddleColor = "white" | "red" | "blue" | "green" | "yellow" | "black";

export const SEAT_PADDLE_COLORS: Readonly<Record<number, PaddleColor>> = {
  1: "white",
  2: "red",
  3: "blue",
  4: "green",
  5: "yellow",
  6: "black",
};

export const PADDLE_COLOR_LABELS: Readonly<Record<PaddleColor, string>> = {
  white: "白",
  red: "红",
  blue: "蓝",
  green: "绿",
  yellow: "黄",
  black: "黑",
};

export function paddleColorForSeat(seatIndex: number): PaddleColor {
  return SEAT_PADDLE_COLORS[seatIndex] ?? "white";
}

export function paddleColorLabelForSeat(seatIndex: number): string {
  return PADDLE_COLOR_LABELS[paddleColorForSeat(seatIndex)];
}
