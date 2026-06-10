declare module "mammoth/mammoth.browser" {
  interface ConversionResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }
  const mammoth: {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<ConversionResult>;
  };
  export default mammoth;
}
