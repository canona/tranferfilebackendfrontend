// Type shim tường minh cho import CSS Modules (`*.module.css`) - Next.js's
// TS plugin thường tự cung cấp qua editor, nhưng khai báo tường minh ở đây để
// `tsc`/`next build`'s type-check không phụ thuộc hành vi ngầm định đó.
declare module '*.module.css' {
  const classes: { readonly [className: string]: string };
  export default classes;
}
