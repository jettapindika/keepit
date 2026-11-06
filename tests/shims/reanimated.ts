export const Easing = {
  bezier: () => (t: number) => t,
  out: (fn: (t: number) => number) => fn,
  cubic: (t: number) => t,
};

export default {};
