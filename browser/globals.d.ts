/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  // Hooks fixture.html and the specs put on window, such as window.card
  interface Window {
    [hook: string]: any;
  }
  interface HTMLElementTagNameMap {
    'apexcharts-card': any;
  }
  type Point = [number, number | null];
  type XY = { x: number; y: number | null };
}
export {};
