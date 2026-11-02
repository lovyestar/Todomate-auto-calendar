// Wrangler bundles *.html imports as text modules.
declare module "*.html" {
  const content: string;
  export default content;
}
