/// <reference types="vite/client" />

// The influencer terms are imported as raw text so the browser hashes exactly
// the bytes the verifying Cloud Function reads. Vite resolves `?raw`; without
// this declaration TypeScript does not know the import has a type.
declare module "*.txt?raw" {
  const content: string;
  export default content;
}
