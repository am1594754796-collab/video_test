/**
 * All six seats use a white raise paddle. Seat identity comes from pose tracking.
 */

export type PaddleColor = "white" | "red" | "blue" | "green" | "yellow" | "black";

export const SEAT_PADDLE_COLORS: Readonly<Record<number, PaddleColor>> = {
  1: "white",
  2: "white",
  3: "white",
  4: "white",
  5: "white",
  6: "white",
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
