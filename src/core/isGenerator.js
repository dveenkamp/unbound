export const isGenerator = (x) => {
  return x && typeof x.next === "function" && typeof x.throw === "function";
};
